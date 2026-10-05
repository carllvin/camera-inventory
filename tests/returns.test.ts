/** Phase 6: return notes - full and partial returns, bulk splits, conflicts, issues. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/server/db/schema";
import { ManualExtractor } from "../src/server/ai";
import type { DocumentExtractor, Extraction, ExtractedLine } from "../src/server/ai/types";
import { createCase, packItem } from "../src/server/domain/cases";
import type { Ctx } from "../src/server/domain/context";
import { addLine, confirmReturn, createDocumentFromUpload, getDocumentReview, reportLineIssue, runExtraction, updateLine } from "../src/server/domain/documents";
import { createItem } from "../src/server/domain/equipment-items";
import { createProject } from "../src/server/domain/projects";
import { createRentalHouse } from "../src/server/domain/rental-houses";
import { LocalStorage } from "../src/server/storage";
import { client, db, makeFixture, type Fixture } from "./helpers/db";

let dir: string;
let storage: LocalStorage;
let f: Fixture;
let ctx: Ctx;
let rhA: { id: string };
let rhB: { id: string };

const pdf = (m: string) => Buffer.from(`%PDF-1.4\n% ${m}\n%%EOF`);

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ci-ret-"));
  storage = new LocalStorage(dir);
  f = await makeFixture();
  ctx = { workspaceId: f.ws.id, userId: f.user.id, role: "owner" };
  rhA = await createRentalHouse(db, ctx, { name: "Rental A" });
  rhB = await createRentalHouse(db, ctx, { name: "Rental B" });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await client.end();
});

/** A fresh project with 3 cameras (one in a case) and 12 cables from rental A. */
async function scenario(name: string) {
  const p = await createProject(db, ctx, { name, status: "shooting" });
  const cams = [];
  for (const n of [1, 2, 3]) cams.push(await createItem(db, ctx, { equipmentTypeId: f.camType.id, serialNumber: `${name}-CAM-${n}`, rentalHouseId: rhA.id, projectId: p.id }));
  const cables = await createItem(db, ctx, { equipmentTypeId: f.cableType.id, quantity: 12, rentalHouseId: rhA.id, projectId: p.id });
  const c = await createCase(db, ctx, { projectId: p.id, name: "A-Cam" });
  await packItem(db, ctx, c.id, cams[0]!.id);
  return { p, cams, cables, caseId: c.id };
}

async function returnNote(projectId: string, rentalHouseId: string | null = rhA.id) {
  const r = await createDocumentFromUpload(db, storage, ctx, new ManualExtractor(), { kind: "return_note", projectId, rentalHouseId }, [{ name: "rueck.pdf", type: "application/pdf", bytes: pdf(Math.random().toString(36)) }]);
  return r.document.id;
}

describe("return notes", () => {
  it("full return: everything from the rental house leaves the project, history intact", async () => {
    const { p, cams, cables, caseId } = await scenario("Full");
    const id = await returnNote(p.id);
    for (const c of cams) await addLine(db, ctx, id, { description: "ALEXA 35", quantity: 1, serialNumber: c.serialNumber });
    await addLine(db, ctx, id, { description: "BNC 1m", quantity: 12, equipmentTypeId: f.cableType.id });
    const review = await getDocumentReview(db, ctx, id);
    expect(review.lines.map((l) => l.resolution)).toEqual(["match_existing", "match_existing", "match_existing", "match_existing"]);
    expect(review.returnOverview).toMatchObject({ returning: 15, staying: [] });

    const r = await confirmReturn(db, ctx, id);
    expect(r).toMatchObject({ returned: 15, remaining: 0 });
    const items = await db.select().from(s.equipmentItem).where(eq(s.equipmentItem.rentalHouseId, rhA.id));
    for (const it of items.filter((i) => [...cams.map((c) => c.id), cables.id].includes(i.id))) {
      expect(it).toMatchObject({ status: "returned", projectId: null, caseId: null });
    }
    const open = await db.select().from(s.projectAssignment).where(and(eq(s.projectAssignment.projectId, p.id), isNull(s.projectAssignment.endedAt)));
    expect(open).toHaveLength(0);
    const closed = await db.select().from(s.projectAssignment).where(eq(s.projectAssignment.returnDocumentId, id));
    expect(closed).toHaveLength(4);
    const events = await db.select().from(s.auditEvent).where(eq(s.auditEvent.documentId, id));
    expect(events.filter((e) => e.action === "equipment_item.returned")).toHaveLength(4);
    expect(events.find((e) => e.action === "equipment_item.removed_from_case")?.caseId).toBe(caseId);
    expect(events.find((e) => e.action === "return_note.imported")?.summary).toContain("nothing from them left");
    // Items stay in the database and can be delivered again later.
    expect((await db.select().from(s.equipmentItem).where(eq(s.equipmentItem.id, cams[0]!.id)))[0]).toBeDefined();
  });

  it("partial return: 2 of 3 cameras and 6 of 12 cables; the rest stays, cables are split", async () => {
    const { p, cams, cables } = await scenario("Partial");
    const id = await returnNote(p.id);
    await addLine(db, ctx, id, { description: "ALEXA 35", quantity: 1, serialNumber: cams[0]!.serialNumber });
    await addLine(db, ctx, id, { description: "ALEXA 35", quantity: 1, serialNumber: cams[1]!.serialNumber });
    await addLine(db, ctx, id, { description: "BNC 1m", quantity: 6, equipmentTypeId: f.cableType.id });
    const review = await getDocumentReview(db, ctx, id);
    expect(review.lines[2]!.matchReason).toContain("6 of 12");
    expect(review.returnOverview!.staying.map((s) => [s.typeName, s.units])).toEqual([
      ["ARRI ALEXA 35", 1],
      ["BNC 1m", 6],
    ]);
    const r = await confirmReturn(db, ctx, id);
    expect(r).toMatchObject({ returned: 8, remaining: 7 });

    const [still] = await db.select().from(s.equipmentItem).where(eq(s.equipmentItem.id, cams[2]!.id));
    expect(still).toMatchObject({ projectId: p.id, status: "on_project" });
    const [rest] = await db.select().from(s.equipmentItem).where(eq(s.equipmentItem.id, cables.id));
    expect(rest).toMatchObject({ quantity: 6, projectId: p.id });
    const [split] = await db.select().from(s.equipmentItem).where(eq(s.equipmentItem.splitFromItemId, cables.id));
    expect(split).toMatchObject({ quantity: 6, status: "returned", projectId: null });
    const [splitAssignment] = await db.select().from(s.projectAssignment).where(eq(s.projectAssignment.equipmentItemId, split!.id));
    expect(splitAssignment).toMatchObject({ returnDocumentId: id, endReason: "returned", quantity: 6 });
    const [openCable] = await db.select().from(s.projectAssignment).where(and(eq(s.projectAssignment.equipmentItemId, cables.id), isNull(s.projectAssignment.endedAt)));
    expect(openCable!.quantity).toBe(6);
    const summary = (await db.select().from(s.auditEvent).where(and(eq(s.auditEvent.documentId, id), eq(s.auditEvent.action, "return_note.imported"))))[0]!.summary;
    expect(summary).toContain("partial return");
    // The rental house relationship is never closed.
    expect(await db.select().from(s.projectRentalHouse).where(and(eq(s.projectRentalHouse.projectId, p.id), eq(s.projectRentalHouse.rentalHouseId, rhA.id)))).toHaveLength(1);
  });

  it("conflicts are shown, never auto-resolved: unknown, other project, already returned, wrong rental house, duplicates", async () => {
    const { p } = await scenario("Conflicts");
    const elsewhere = await createItem(db, ctx, { equipmentTypeId: f.camType.id, serialNumber: "ELSEWHERE-1", rentalHouseId: rhA.id, projectId: f.project2.id });
    void elsewhere;
    const old = await createItem(db, ctx, { equipmentTypeId: f.camType.id, serialNumber: "OLD-RET-1", rentalHouseId: rhA.id });
    await db.update(s.equipmentItem).set({ status: "returned" }).where(eq(s.equipmentItem.id, old.id));
    const fromB = await createItem(db, ctx, { equipmentTypeId: f.camType.id, serialNumber: "FROM-B-1", rentalHouseId: rhB.id, projectId: p.id });
    void fromB;
    const id = await returnNote(p.id);
    for (const sn of ["NEVER-SEEN-9", "ELSEWHERE-1", "OLD-RET-1", "FROM-B-1", "Conflicts-CAM-1", "conflicts cam 1"]) {
      await addLine(db, ctx, id, { description: "Camera", quantity: 1, serialNumber: sn });
    }
    const r = await getDocumentReview(db, ctx, id);
    const reasons = r.lines.map((l) => [l.resolution, l.matchReason]);
    expect(reasons[0]).toEqual(["discrepancy", expect.stringContaining("unknown equipment")]);
    expect(reasons[1]).toEqual(["discrepancy", expect.stringContaining("is on Project B")]);
    expect(reasons[2]).toEqual(["discrepancy", expect.stringContaining("already returned")]);
    expect(reasons[3]).toEqual(["discrepancy", expect.stringContaining("belongs to Rental B")]);
    expect(reasons[4]![0]).toBe("match_existing");
    expect(reasons[5]).toEqual(["discrepancy", expect.stringContaining("appears twice")]);
    await expect(confirmReturn(db, ctx, id)).rejects.toThrow(/fix it or ignore/);

    // Report the unknown line as an issue, ignore the problem lines, confirm the rest.
    const issue = await reportLineIssue(db, ctx, r.lines[0]!.id, "Rental house listed a camera we never received");
    expect(issue).toMatchObject({ type: "return_mismatch", documentId: id, projectId: p.id, status: "open" });
    for (const l of r.lines.filter((l) => l.resolution === "discrepancy")) {
      await updateLine(db, ctx, l.id, { description: l.description, quantity: 1, serialNumber: l.serialNumber, ignore: "1" });
    }
    const done = await confirmReturn(db, ctx, id);
    expect(done.returned).toBe(1);
    const [b] = await db.select().from(s.equipmentItem).where(eq(s.equipmentItem.serialNumber, "FROM-B-1"));
    expect(b!.projectId).toBe(p.id); // untouched
  });

  it("lines without serials: the only item is matched, otherwise the reviewer picks which one", async () => {
    const { p, cams } = await scenario("Pick");
    const id = await returnNote(p.id);
    const line = await addLine(db, ctx, id, { description: "ALEXA 35 body", quantity: 1, equipmentTypeId: f.camType.id });
    let r = await getDocumentReview(db, ctx, id);
    expect(r.lines[0]).toMatchObject({ resolution: "pending", matchReason: expect.stringContaining("3 ARRI ALEXA 35 on the project") });
    await updateLine(db, ctx, line.id, { description: "ALEXA 35 body", quantity: 1, equipmentItemId: cams[1]!.id });
    r = await getDocumentReview(db, ctx, id);
    expect(r.lines[0]).toMatchObject({ resolution: "match_existing", matchedEquipmentItemId: cams[1]!.id });

    // AI path: "2 × ALEXA 35" on a project that has exactly two left -> expanded and auto-matched.
    const p2 = await createProject(db, ctx, { name: "Two left", status: "wrap" });
    for (const n of [1, 2]) await createItem(db, ctx, { equipmentTypeId: f.camType.id, serialNumber: `TWO-${n}`, rentalHouseId: rhA.id, projectId: p2.id });
    const line2: ExtractedLine = { raw_text: "2 ALEXA 35", description: "ALEXA 35", manufacturer: "ARRI", model: "ALEXA 35", quantity: 2, serial_numbers: [], asset_numbers: [], catalog_match: "ARRI ALEXA 35", is_equipment: true, confidence: 0.9 };
    const ex: Extraction = { document_type: "return_note", rental_house_name: "Rental A", rental_house_match: "Rental A", document_number: "RT-2", document_date: "2026-11-01", project_reference: null, lines: [line2], warnings: [] };
    const fake: DocumentExtractor = { provider: "fake", model: "f", available: true, extract: async () => ({ extraction: ex, provider: "fake", model: "f", meta: {} }) };
    const up = await createDocumentFromUpload(db, storage, ctx, fake, { kind: "return_note", projectId: p2.id }, [{ name: "r.pdf", type: "application/pdf", bytes: pdf("two") }]);
    await runExtraction(db, storage, fake, ctx.workspaceId, up.document.id);
    const r2 = await getDocumentReview(db, ctx, up.document.id);
    expect(r2.doc.rentalHouseId).toBe(rhA.id);
    expect(r2.lines.map((l) => [l.quantity, l.resolution])).toEqual([[1, "match_existing"], [1, "match_existing"]]);
    expect(new Set(r2.lines.map((l) => l.matchedEquipmentItemId)).size).toBe(2);
    expect((await confirmReturn(db, ctx, up.document.id)).remaining).toBe(0);
  });

  it("viewers cannot confirm; other workspaces cannot see the note", async () => {
    const { p, cams } = await scenario("Perm");
    const id = await returnNote(p.id);
    await addLine(db, ctx, id, { description: "x", quantity: 1, serialNumber: cams[0]!.serialNumber });
    await expect(confirmReturn(db, { ...ctx, role: "viewer" }, id)).rejects.toThrow("permission");
    const other = await makeFixture();
    await expect(confirmReturn(db, { workspaceId: other.ws.id, userId: other.user.id, role: "owner" }, id)).rejects.toThrow("not found");
  });
});
