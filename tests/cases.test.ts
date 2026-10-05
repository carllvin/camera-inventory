/** Phase 4: cases, expected vs. actual, packing, templates. */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/server/db/schema";
import { buildCategoryClosure, compareCase } from "../src/server/domain/case-compare";
import {
  addExpectedLine,
  addTemplateLine,
  archiveCase,
  createCase,
  createTemplate,
  createTemplateFromCase,
  getCaseDetail,
  getTemplate,
  listCases,
  packByCode,
  packItem,
  removeExpectedLine,
  unpackItem,
  updateExpectedLine,
} from "../src/server/domain/cases";
import { DomainError, type Ctx } from "../src/server/domain/context";
import { createCategory } from "../src/server/domain/categories";
import { createItem, removeFromProject } from "../src/server/domain/equipment-items";
import { createEquipmentType } from "../src/server/domain/equipment-types";
import { client, db, itemOnProject, makeFixture, type Fixture } from "./helpers/db";

let f: Fixture;
let ctx: Ctx;

beforeAll(async () => {
  f = await makeFixture();
  ctx = { workspaceId: f.ws.id, userId: f.user.id, role: "owner" };
});

afterAll(async () => {
  await client.end();
});

async function domainError(p: Promise<unknown>) {
  const err = await p.then(() => undefined, (e: unknown) => e);
  expect(err).toBeInstanceOf(DomainError);
  return err as DomainError;
}

describe("compareCase (pure)", () => {
  const closure = buildCategoryClosure([
    { id: "power", parentId: null },
    { id: "batteries", parentId: "power" },
    { id: "camera", parentId: null },
  ]);
  const line = (id: string, quantity: number, t: { type?: string; cat?: string }, sortOrder = 0) => ({
    id,
    label: id,
    quantity,
    equipmentTypeId: t.type ?? null,
    categoryId: t.cat ?? null,
    sortOrder,
  });

  it("A-Cam case: 7 of 8 with one battery short", () => {
    const expected = [line("body", 1, { type: "alexa" }, 0), line("mvf", 1, { type: "mvf" }, 1), line("bat", 2, { type: "b290" }, 2), line("misc", 4, { type: "misc" }, 3)];
    const items = [
      { id: "i1", equipmentTypeId: "alexa", categoryId: "camera", quantity: 1 },
      { id: "i2", equipmentTypeId: "mvf", categoryId: "camera", quantity: 1 },
      { id: "i3", equipmentTypeId: "b290", categoryId: "batteries", quantity: 1 },
      { id: "i4", equipmentTypeId: "misc", categoryId: null, quantity: 4 },
    ];
    const r = compareCase(expected, items, closure);
    expect([r.matchedTotal, r.expectedTotal, r.missingTotal, r.extraTotal]).toEqual([7, 8, 1, 0]);
    expect(r.lines.find((l) => l.line.id === "bat")).toMatchObject({ matched: 1, missing: 1 });
    expect(r.complete).toBe(false);
  });

  it("category lines accept subcategories; type lines claim first; leftovers are extra", () => {
    const expected = [line("anyPower", 2, { cat: "power" }, 0), line("b290", 1, { type: "b290" }, 1)];
    const items = [
      { id: "b1", equipmentTypeId: "b290", categoryId: "batteries", quantity: 1 },
      { id: "b2", equipmentTypeId: "b290", categoryId: "batteries", quantity: 1 },
      { id: "v1", equipmentTypeId: "vmount", categoryId: "batteries", quantity: 1 },
      { id: "x", equipmentTypeId: "alexa", categoryId: "camera", quantity: 1 },
    ];
    const r = compareCase(expected, items, closure);
    // The type line claims b1 even though the category line is listed first.
    expect(r.lines.find((l) => l.line.id === "b290")!.items).toEqual([{ id: "b1", units: 1 }]);
    expect(r.lines.find((l) => l.line.id === "anyPower")!.matched).toBe(2);
    expect(r.extras).toEqual([{ id: "x", units: 1 }]);
  });

  it("bulk quantities split across lines and count leftovers", () => {
    const r = compareCase([line("bnc", 6, { type: "bnc" })], [{ id: "bulk", equipmentTypeId: "bnc", categoryId: null, quantity: 10 }], closure);
    expect(r.lines[0]!.matched).toBe(6);
    expect(r.extras).toEqual([{ id: "bulk", units: 4 }]);
    expect(r.actualTotal).toBe(10);
  });
});

describe("cases and templates", () => {
  it("creates a case from a template, packs items and reports 7/8-style status", async () => {
    const batteryCat = await createCategory(db, ctx, { name: "Batteries" });
    const batteryType = await createEquipmentType(db, ctx, { manufacturer: "bebob", model: "B290cine", categoryId: batteryCat.id });
    const tpl = await createTemplate(db, ctx, { name: "A-Cam Case" });
    await addTemplateLine(db, ctx, tpl.id, { target: `type:${f.camType.id}`, quantity: 1 });
    await addTemplateLine(db, ctx, tpl.id, { target: `category:${batteryCat.id}`, label: "Batteries", quantity: 2 });
    expect((await getTemplate(db, ctx, tpl.id)).lines.map((l) => l.label)).toEqual(["ARRI ALEXA 35", "Batteries"]);

    const c = await createCase(db, ctx, { projectId: f.project.id, name: "A-Cam Case", code: "A-CAM 1", templateId: tpl.id });
    const body = await itemOnProject(f, { serialNumber: "CASE-BODY" });
    const bat = await createItem(db, ctx, { equipmentTypeId: batteryType.id, serialNumber: "B-1", projectId: f.project.id });
    await packItem(db, ctx, c.id, body.id);
    await packItem(db, ctx, c.id, bat.id);

    const detail = await getCaseDetail(db, ctx, c.id);
    expect([detail.comparison.matchedTotal, detail.comparison.expectedTotal]).toEqual([2, 3]);
    const summary = (await listCases(db, ctx, { projectId: f.project.id })).find((x) => x.id === c.id)!;
    expect(summary.comparison.missingTotal).toBe(1);

    // History: case created + both packings recorded against the case.
    const events = await db.select().from(s.auditEvent).where(eq(s.auditEvent.caseId, c.id)).orderBy(s.auditEvent.id);
    expect(events.map((e) => e.action)).toEqual(["case.created", "equipment_item.added_to_case", "equipment_item.added_to_case"]);
  });

  it("an item is in one case at a time; moving needs explicit confirmation", async () => {
    const a = await createCase(db, ctx, { projectId: f.project.id, name: "Case A" });
    const b = await createCase(db, ctx, { projectId: f.project.id, name: "Case B" });
    const item = await itemOnProject(f, { serialNumber: "MOVE-CASE-1" });
    await packItem(db, ctx, a.id, item.id);
    const err = await domainError(packItem(db, ctx, b.id, item.id));
    expect(err.code).toBe("CONFLICT");
    expect(err.details).toMatchObject({ needsMoveConfirmation: true, fromCaseName: "Case A" });
    const r = await packItem(db, ctx, b.id, item.id, { allowMove: true });
    expect(r.moved).toBe(true);
    const [row] = await db.select().from(s.equipmentItem).where(eq(s.equipmentItem.id, item.id));
    expect(row!.caseId).toBe(b.id);
    const events = await db.select().from(s.auditEvent).where(eq(s.auditEvent.equipmentItemId, item.id)).orderBy(s.auditEvent.id);
    expect(events.slice(-2).map((e) => [e.action, e.caseId])).toEqual([
      ["equipment_item.removed_from_case", a.id],
      ["equipment_item.added_to_case", b.id],
    ]);
  });

  it("only items on the case's project can be packed", async () => {
    const c = await createCase(db, ctx, { projectId: f.project.id, name: "Project A case" });
    const offProject = await createItem(db, ctx, { equipmentTypeId: f.camType.id, serialNumber: "OFF-1" });
    expect((await domainError(packItem(db, ctx, c.id, offProject.id))).message).toContain("not on this project");
    const other = await itemOnProject(f, { serialNumber: "P2-1", projectId: f.project2.id });
    expect((await domainError(packItem(db, ctx, c.id, other.id))).message).toContain("another project");
  });

  it("packs by scanned code, unpacks, and removing from project empties the case slot", async () => {
    const c = await createCase(db, ctx, { projectId: f.project.id, name: "Scan case" });
    const item = await itemOnProject(f, { serialNumber: "SCAN-PACK", barcode: "QR-PACK-1" });
    await packByCode(db, ctx, c.id, "qr-pack-1".toUpperCase());
    expect((await getCaseDetail(db, ctx, c.id)).items.map((i) => i.id)).toEqual([item.id]);
    expect((await domainError(packByCode(db, ctx, c.id, "NOPE-404"))).code).toBe("NOT_FOUND");
    await unpackItem(db, ctx, item.id);
    expect((await getCaseDetail(db, ctx, c.id)).items).toHaveLength(0);
    await packItem(db, ctx, c.id, item.id);
    await removeFromProject(db, ctx, item.id, { reason: "wrong project" });
    expect((await getCaseDetail(db, ctx, c.id)).items).toHaveLength(0);
  });

  it("edits expected contents with audit; saves a case as a template", async () => {
    const c = await createCase(db, ctx, { projectId: f.project.id, name: "Custom case" });
    const line = await addExpectedLine(db, ctx, c.id, { target: `type:${f.cableType.id}`, quantity: 6 });
    expect(line.label).toBe("BNC 1m");
    await updateExpectedLine(db, ctx, line.id, { label: "BNC cables", quantity: 8 });
    const tpl = await createTemplateFromCase(db, ctx, c.id, { name: "Video cables" });
    expect((await getTemplate(db, ctx, tpl.id)).lines).toMatchObject([{ label: "BNC cables", quantity: 8 }]);
    await removeExpectedLine(db, ctx, line.id);
    expect((await getCaseDetail(db, ctx, c.id)).lines).toHaveLength(0);
    const summaries = (await db.select().from(s.auditEvent).where(eq(s.auditEvent.caseId, c.id))).map((e) => e.summary);
    expect(summaries).toContain("Custom case: expected BNC cables 6 → 8");
  });

  it("case names are unique per project; non-empty cases cannot be archived", async () => {
    const c = await createCase(db, ctx, { projectId: f.project.id, name: "Lens Case" });
    expect((await domainError(createCase(db, ctx, { projectId: f.project.id, name: "lens case" }))).code).toBe("CONFLICT");
    await createCase(db, ctx, { projectId: f.project2.id, name: "Lens Case" }); // other project is fine
    const item = await itemOnProject(f, { serialNumber: "ARCH-1" });
    await packItem(db, ctx, c.id, item.id);
    expect((await domainError(archiveCase(db, ctx, c.id))).message).toContain("Unpack");
    await unpackItem(db, ctx, item.id);
    await archiveCase(db, ctx, c.id);
    // The name is free again once archived.
    await createCase(db, ctx, { projectId: f.project.id, name: "Lens Case" });
  });

  it("is isolated per workspace and read-only for viewers", async () => {
    const other = await makeFixture();
    const otherCtx: Ctx = { workspaceId: other.ws.id, userId: other.user.id, role: "owner" };
    const c = await createCase(db, ctx, { projectId: f.project.id, name: "Private case" });
    expect((await domainError(getCaseDetail(db, otherCtx, c.id))).code).toBe("NOT_FOUND");
    expect((await domainError(createCase(db, otherCtx, { projectId: f.project.id, name: "x" }))).code).toBe("NOT_FOUND");
    expect((await domainError(addExpectedLine(db, ctx, c.id, { target: `type:${other.camType.id}`, quantity: 1 }))).code).toBe("NOT_FOUND");
    expect((await domainError(createCase(db, { ...ctx, role: "viewer" }, { projectId: f.project.id, name: "y" }))).code).toBe("FORBIDDEN");
  });
});
