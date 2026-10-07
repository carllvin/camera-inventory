/** Fluid tracking: items without serial are interchangeable units - grouped, packed and changed by count. */
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/server/db/schema";
import { createCase, getCaseDetail, groupUnits, listPackCandidates, packUnits, unpackUnits } from "../src/server/domain/cases";
import { DomainError, type Ctx } from "../src/server/domain/context";
import { changeCondition, changeStatus } from "../src/server/domain/equipment-items";
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

const bulk = (quantity: number, values: Partial<typeof s.equipmentItem.$inferInsert> = {}) =>
  itemOnProject(f, { equipmentTypeId: f.cableType.id, trackingMode: "bulk", quantity, ...values });

async function openAssignments(itemId: string) {
  return db.select().from(s.projectAssignment).where(and(eq(s.projectAssignment.equipmentItemId, itemId), isNull(s.projectAssignment.endedAt)));
}

describe("groupUnits (pure)", () => {
  const base = { equipmentTypeId: "t", rentalHouseId: "r", caseId: null, status: "on_project", condition: "ok", quantity: 1 };
  it("collapses items without serial, keeps serialized ones apart", () => {
    const rows = groupUnits([
      { ...base, id: "a", serialNumber: null, quantity: 4 },
      { ...base, id: "b", serialNumber: null },
      { ...base, id: "c", serialNumber: "SN1" },
      { ...base, id: "d", serialNumber: "SN2" },
      { ...base, id: "e", serialNumber: null, condition: "damaged" },
      { ...base, id: "f", serialNumber: null, caseId: "other" },
    ]);
    expect(rows.map((r) => [r.id, r.itemIds, r.units])).toEqual([
      ["a", ["a", "b"], 5],
      ["c", ["c"], 1],
      ["d", ["d"], 1],
      ["e", ["e"], 1],
      ["f", ["f"], 1],
    ]);
  });
});

describe("packing by count", () => {
  it("packs part of a bulk item by splitting it and keeps history on both", async () => {
    const c = await createCase(db, ctx, { name: `Cables ${Date.now()}`, projectId: f.project.id });
    const a = await bulk(10);
    const b = await bulk(2);
    const r = await packUnits(db, ctx, c.id, [a.id, b.id], 5);
    expect(r).toMatchObject({ packed: 5, moved: false, short: 0 });

    const d = await getCaseDetail(db, ctx, c.id);
    expect(d.items.reduce((n, i) => n + i.quantity, 0)).toBe(5);
    // The pack list still shows the rest as one row.
    const rows = groupUnits(await listPackCandidates(db, ctx, c.id));
    const cables = rows.filter((x) => x.equipmentTypeId === f.cableType.id);
    expect(cables.map((x) => x.units)).toEqual([7]);

    // Every split part has its own open assignment with the right quantity.
    const all = await db.select().from(s.equipmentItem).where(eq(s.equipmentItem.equipmentTypeId, f.cableType.id));
    for (const i of all.filter((x) => x.projectId)) {
      const [open] = await openAssignments(i.id);
      expect(open?.quantity).toBe(i.quantity);
    }
    const split = all.find((x) => x.splitFromItemId);
    expect(split).toBeTruthy();
    const events = await db.select().from(s.auditEvent).where(eq(s.auditEvent.action, "equipment_item.split"));
    expect(events.some((e) => e.equipmentItemId === split!.id)).toBe(true);

    // Take three back out: the case keeps two.
    const packed = groupUnits(d.items);
    await unpackUnits(db, ctx, packed[0]!.itemIds, 3);
    const after = await getCaseDetail(db, ctx, c.id);
    expect(after.items.reduce((n, i) => n + i.quantity, 0)).toBe(2);
  });

  it("asks before moving units out of another case and rejects serialized items", async () => {
    const one = await createCase(db, ctx, { name: `One ${Date.now()}`, projectId: f.project.id });
    const two = await createCase(db, ctx, { name: `Two ${Date.now()}`, projectId: f.project.id });
    const a = await bulk(6, { caseId: one.id });
    const err = await packUnits(db, ctx, two.id, [a.id], 2).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).details?.needsMoveConfirmation).toBe(true);
    // Nothing was split by the failed attempt.
    const [still] = await db.select().from(s.equipmentItem).where(eq(s.equipmentItem.id, a.id));
    expect(still!.quantity).toBe(6);

    const r = await packUnits(db, ctx, two.id, [a.id], 2, { allowMove: true });
    expect(r).toMatchObject({ packed: 2, moved: true });
    const [rest] = await db.select().from(s.equipmentItem).where(eq(s.equipmentItem.id, a.id));
    expect(rest).toMatchObject({ quantity: 4, caseId: one.id });

    const cam = await itemOnProject(f, { serialNumber: `U-${Date.now()}` });
    await expect(packUnits(db, ctx, two.id, [cam.id], 1)).rejects.toThrow(/serial number/);
  });
});

describe("changing some units", () => {
  it("changes condition of all or only some units", async () => {
    const a = await bulk(8);
    const some = await changeCondition(db, ctx, a.id, { condition: "damaged", units: 2, note: "cut" });
    expect(some.id).not.toBe(a.id);
    const [orig] = await db.select().from(s.equipmentItem).where(eq(s.equipmentItem.id, a.id));
    const [part] = await db.select().from(s.equipmentItem).where(eq(s.equipmentItem.id, some.id));
    expect(orig).toMatchObject({ quantity: 6, condition: "unknown" });
    expect(part).toMatchObject({ quantity: 2, condition: "damaged", splitFromItemId: a.id, projectId: f.project.id });

    const all = await changeCondition(db, ctx, a.id, { condition: "ok", units: 6 });
    expect(all.id).toBe(a.id);
    await expect(changeCondition(db, ctx, a.id, { condition: "damaged", units: 0 })).rejects.toThrow();
  });

  it("marks only some units missing", async () => {
    const a = await bulk(5);
    const r = await changeStatus(db, ctx, a.id, { status: "missing", units: "1" as unknown as number });
    const [part] = await db.select().from(s.equipmentItem).where(eq(s.equipmentItem.id, r.id));
    expect(part).toMatchObject({ quantity: 1, status: "missing" });
    const cam = await itemOnProject(f, { serialNumber: `M-${Date.now()}` });
    expect((await changeStatus(db, ctx, cam.id, { status: "in_use", units: 1 })).id).toBe(cam.id);
  });
});

describe("item page: one save for status, condition and case", () => {
  it("applies all changes to some units of a bulk item via one split", async () => {
    const { updateItemState } = await import("../src/server/domain/item-state");
    const c = await createCase(db, ctx, { name: `State ${Date.now()}`, projectId: f.project.id });
    const a = await bulk(6);
    const r = await updateItemState(db, ctx, a.id, { status: "in_use", condition: "damaged", caseId: c.id, units: 2, note: "rain" });
    expect(r).toMatchObject({ split: true, changed: ["status", "condition", "case"] });
    const [part] = await db.select().from(s.equipmentItem).where(eq(s.equipmentItem.id, r.item.id));
    expect(part).toMatchObject({ quantity: 2, status: "in_use", condition: "damaged", caseId: c.id, splitFromItemId: a.id });
    const [rest] = await db.select().from(s.equipmentItem).where(eq(s.equipmentItem.id, a.id));
    expect(rest).toMatchObject({ quantity: 4, status: "on_project", caseId: null });

    // Unchanged values are no-ops; "" takes it out of the case.
    expect((await updateItemState(db, ctx, r.item.id, { status: "in_use", condition: "damaged" })).changed).toEqual([]);
    expect((await updateItemState(db, ctx, r.item.id, { caseId: "" })).changed).toEqual(["case"]);
  });
});

describe("expected contents made easy", () => {
  it("uses what is packed, steps quantities and merges repeated types", async () => {
    const { addExpectedLine, getCaseDetail: detail, setExpectedFromContents, stepExpectedLine } = await import("../src/server/domain/cases");
    const c = await createCase(db, ctx, { name: `Expect ${Date.now()}`, projectId: f.project.id });
    await expect(setExpectedFromContents(db, ctx, c.id)).rejects.toThrow(/empty/);
    const cam = await itemOnProject(f, { serialNumber: `X-${Date.now()}`, caseId: c.id });
    await bulk(3, { caseId: c.id });
    expect(await setExpectedFromContents(db, ctx, c.id)).toBe(2);
    let d = await detail(db, ctx, c.id);
    expect(d.comparison.complete).toBe(true);
    expect(d.lines.map((l) => [l.label, l.quantity]).sort()).toEqual([["ARRI ALEXA 35", 1], ["BNC 1m", 3]]);

    // Adding the same type again counts it up; − to zero removes the line.
    await addExpectedLine(db, ctx, c.id, { target: `type:${cam.equipmentTypeId}`, quantity: 1 });
    d = await detail(db, ctx, c.id);
    const camLine = d.lines.find((l) => l.label === "ARRI ALEXA 35")!;
    expect(camLine.quantity).toBe(2);
    await stepExpectedLine(db, ctx, camLine.id, -1);
    await stepExpectedLine(db, ctx, camLine.id, -1);
    d = await detail(db, ctx, c.id);
    expect(d.lines.map((l) => l.label)).toEqual(["BNC 1m"]);
  });
});

describe("type names", () => {
  it("leave out placeholder makers like Generic", async () => {
    const { createEquipmentType } = await import("../src/server/domain/equipment-types");
    const tag = Date.now().toString(36);
    expect((await createEquipmentType(db, ctx, { manufacturer: "Generic", model: `Cheese Plate ${tag}` }))!.name).toBe(`Cheese Plate ${tag}`);
    expect((await createEquipmentType(db, ctx, { manufacturer: "Tilta", model: `Nucleus ${tag}` }))!.name).toBe(`Tilta Nucleus ${tag}`);
  });
});
