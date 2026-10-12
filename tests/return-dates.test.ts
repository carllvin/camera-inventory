/** Return dates (project end → delivery → set → piece) and planned extra equipment. */
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as s from "../src/server/db/schema";
import type { Ctx } from "../src/server/domain/context";
import { allocate, cancelNeed, createNeed, fulfilNeeds, listNeeds, restoreNeed, updateNeed } from "../src/server/domain/planned-needs";
import { addDays, bucketDue, containerReturnInfo, daysBetween, itemReturnInfo, listDueItems, setReturnDue, shiftReturnDue } from "../src/server/domain/return-dates";
import { revertEvent } from "../src/server/domain/revert";
import { client, db, itemOnProject, makeFixture, type Fixture } from "./helpers/db";

afterAll(async () => {
  await client.end();
});

const ctxOf = (f: Fixture): Ctx => ({ workspaceId: f.ws.id, userId: f.user.id, role: "owner" });

async function deliveredWith(f: Fixture, itemId: string, number = "LS-1") {
  const [doc] = await db
    .insert(s.document)
    .values({ workspaceId: f.ws.id, kind: "delivery_note", status: "confirmed", projectId: f.project.id, rentalHouseId: f.rentalHouse.id, confirmedAt: new Date(), documentNumber: number })
    .returning();
  await db.update(s.projectAssignment).set({ deliveryDocumentId: doc!.id }).where(eq(s.projectAssignment.equipmentItemId, itemId));
  return doc!;
}

async function lastEvent(entityId: string) {
  const rows = await db.select().from(s.auditEvent).where(eq(s.auditEvent.entityId, entityId)).orderBy(s.auditEvent.id);
  return rows.at(-1)!;
}

describe("date helpers", () => {
  it("adds days across months and counts days between", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-10-30", "2026-11-02")).toBe(3);
    expect(daysBetween("2026-11-02", "2026-10-30")).toBe(-3);
  });
});

describe("return dates", () => {
  it("come from the most specific level: piece → set → delivery → project end", async () => {
    const f = await makeFixture();
    const ctx = ctxOf(f);
    const item = await itemOnProject(f, { serialNumber: "RD-1" });
    expect((await itemReturnInfo(db, ctx, item.id))!.due).toBeNull();

    await db.update(s.project).set({ endDate: "2026-12-20" }).where(eq(s.project.id, f.project.id));
    expect(await itemReturnInfo(db, ctx, item.id)).toMatchObject({ due: "2026-12-20", source: "project" });

    const doc = await deliveredWith(f, item.id);
    await setReturnDue(db, ctx, { kind: "document", id: doc.id }, "2026-12-01");
    expect(await itemReturnInfo(db, ctx, item.id)).toMatchObject({ due: "2026-12-01", source: "document", documentNumber: "LS-1" });

    const [set] = await db.insert(s.equipmentCase).values({ workspaceId: f.ws.id, projectId: f.project.id, name: "Bags" }).returning();
    await db.update(s.equipmentItem).set({ caseId: set!.id }).where(eq(s.equipmentItem.id, item.id));
    await setReturnDue(db, ctx, { kind: "case", id: set!.id }, "2026-11-25");
    expect(await itemReturnInfo(db, ctx, item.id)).toMatchObject({ due: "2026-11-25", source: "case" });

    await setReturnDue(db, ctx, { kind: "item", id: item.id }, "2026-11-20");
    expect(await itemReturnInfo(db, ctx, item.id)).toMatchObject({ due: "2026-11-20", source: "item", own: "2026-11-20" });

    // Clearing follows the next level again.
    await setReturnDue(db, ctx, { kind: "item", id: item.id }, "");
    expect(await itemReturnInfo(db, ctx, item.id)).toMatchObject({ due: "2026-11-25", source: "case" });
    expect(await containerReturnInfo(db, ctx, { kind: "document", id: doc.id })).toMatchObject({ own: "2026-12-01", inherited: "2026-12-20" });
  });

  it("moves by days from the current (also inherited) date, and every change can be undone", async () => {
    const f = await makeFixture();
    const ctx = ctxOf(f);
    await db.update(s.project).set({ endDate: "2026-12-20" }).where(eq(s.project.id, f.project.id));
    const item = await itemOnProject(f, { serialNumber: "RD-2" });
    const doc = await deliveredWith(f, item.id, "LS-2");

    await shiftReturnDue(db, ctx, { kind: "document", id: doc.id }, 2);
    expect((await itemReturnInfo(db, ctx, item.id))!.due).toBe("2026-12-22");
    await shiftReturnDue(db, ctx, { kind: "document", id: doc.id }, -5);
    expect((await itemReturnInfo(db, ctx, item.id))!.due).toBe("2026-12-17");

    const ev = await lastEvent(doc.id);
    expect(ev.action).toBe("return_due.changed");
    expect(ev.summary).toBe("Delivery LS-2: return by 2026-12-17");
    await revertEvent(db, ctx, ev.id);
    expect((await itemReturnInfo(db, ctx, item.id))!.due).toBe("2026-12-22");
    // An older change can't be undone over a newer one.
    const events = await db.select().from(s.auditEvent).where(and(eq(s.auditEvent.entityId, doc.id), eq(s.auditEvent.action, "return_due.changed"))).orderBy(s.auditEvent.id);
    await setReturnDue(db, ctx, { kind: "document", id: doc.id }, "2027-01-05");
    await expect(revertEvent(db, ctx, events[0]!.id)).rejects.toThrow(/changed again/);
  });

  it("refuses to move without any date, and only for members", async () => {
    const f = await makeFixture();
    const item = await itemOnProject(f, { serialNumber: "RD-3" });
    await expect(shiftReturnDue(db, ctxOf(f), { kind: "item", id: item.id }, 1)).rejects.toThrow(/no return date/);
    await expect(setReturnDue(db, { ...ctxOf(f), role: "viewer" }, { kind: "item", id: item.id }, "2026-11-01")).rejects.toThrow();
  });

  it("are grouped into overdue, due soon and without date", async () => {
    const f = await makeFixture();
    const ctx = ctxOf(f);
    const a = await itemOnProject(f, { serialNumber: "B-1", returnDue: "2026-10-01" });
    await itemOnProject(f, { serialNumber: "B-2", returnDue: "2026-10-12" });
    await itemOnProject(f, { serialNumber: "B-3", returnDue: "2026-11-30" });
    await itemOnProject(f, { serialNumber: "B-4" });
    const rows = await listDueItems(db, ctx, { projectId: f.project.id });
    const b = bucketDue(rows, "2026-10-10", 3);
    expect(b.overdue.map((i) => i.id)).toEqual([a.id]);
    expect(b.soon.map((i) => i.serialNumber)).toEqual(["B-2"]);
    expect(b.undatedUnits).toBe(1);
    expect((await listDueItems(db, ctx, { projectId: f.project.id, until: "2026-10-12" })).length).toBe(2);
  });
});

describe("planned extra equipment", () => {
  it("is created with an order date, changed, cancelled, restored and undone", async () => {
    const f = await makeFixture();
    const ctx = ctxOf(f);
    const need = await createNeed(db, ctx, f.project.id, { equipmentTypeId: f.cableType.id, quantity: 4, needFrom: "2026-11-14", needUntil: "2026-11-16" });
    expect(need).toMatchObject({ orderBy: "2026-11-12", status: "open", label: f.cableType.name });
    await expect(createNeed(db, ctx, f.project.id, { needFrom: "2026-11-14", needUntil: "2026-11-13", label: "X" })).rejects.toThrow();
    await updateNeed(db, ctx, need.id, { equipmentTypeId: f.cableType.id, quantity: 6, needFrom: "2026-11-14", needUntil: "2026-11-17", orderBy: "2026-11-10" });
    expect((await listNeeds(db, ctx, { projectId: f.project.id }))[0]).toMatchObject({ quantity: 6, needUntil: "2026-11-17", orderBy: "2026-11-10" });

    await cancelNeed(db, ctx, need.id);
    expect((await listNeeds(db, ctx, { projectId: f.project.id, status: ["open"] })).length).toBe(0);
    await revertEvent(db, ctx, (await lastEvent(need.id)).id);
    expect((await listNeeds(db, ctx, { projectId: f.project.id, status: ["open"] })).length).toBe(1);
    await cancelNeed(db, ctx, need.id);
    await restoreNeed(db, ctx, need.id);
    expect((await listNeeds(db, ctx, { projectId: f.project.id }))[0]!.status).toBe("open");
  });

  it("is fulfilled by a delivery of the same type in time; the pieces get its end date", async () => {
    const f = await makeFixture();
    const ctx = ctxOf(f);
    const need = await createNeed(db, ctx, f.project.id, { equipmentTypeId: f.cableType.id, quantity: 2, needFrom: "2026-11-14", needUntil: "2026-11-16", rentalHouseId: f.rentalHouse.id });
    const other = await createNeed(db, ctx, f.project.id, { equipmentTypeId: f.camType.id, quantity: 1, needFrom: "2026-12-14", needUntil: "2026-12-16" });
    const c1 = await itemOnProject(f, { equipmentTypeId: f.cableType.id, trackingMode: "bulk", quantity: 2 });
    const cam = await itemOnProject(f, { serialNumber: "CAM-9" });
    const doc = await deliveredWith(f, c1.id, "LS-N");
    const done = await fulfilNeeds(db, ctx, { ...doc, documentDate: "2026-11-13" }, [c1.id, cam.id], "2026-11-13", crypto.randomUUID());
    expect(done.map((d) => d.need.id)).toEqual([need.id]);
    const rows = await listNeeds(db, ctx, { projectId: f.project.id });
    expect(rows.find((r) => r.id === need.id)).toMatchObject({ status: "fulfilled", fulfilledDocumentId: doc.id });
    expect(rows.find((r) => r.id === other.id)!.status).toBe("open");
    expect((await itemReturnInfo(db, ctx, c1.id))!).toMatchObject({ due: "2026-11-16", source: "item" });
    expect((await itemReturnInfo(db, ctx, cam.id))!.due).toBeNull();
  });

  it("allocation respects rental house, the time window and each piece only once", () => {
    const base = { workspaceId: "w", projectId: "p", label: "x", notes: null, orderBy: null, fulfilledDocumentId: null, createdById: null, createdAt: new Date(), updatedAt: new Date(), status: "open" as const };
    const needs = [
      { ...base, id: "n1", equipmentTypeId: "T", quantity: 2, rentalHouseId: null, needFrom: "2026-11-14", needUntil: "2026-11-16" },
      { ...base, id: "n2", equipmentTypeId: "T", quantity: 1, rentalHouseId: "RH-B", needFrom: "2026-11-14", needUntil: "2026-11-16" },
      { ...base, id: "n3", equipmentTypeId: "T", quantity: 1, rentalHouseId: null, needFrom: "2027-02-01", needUntil: "2027-02-02" },
    ];
    const pieces = [
      { id: "a", typeId: "T", units: 1 },
      { id: "b", typeId: "T", units: 1 },
      { id: "c", typeId: "T", units: 1 },
    ];
    const out = allocate(needs, pieces, { rentalHouseId: "RH-A", date: "2026-11-13" });
    expect(out.map((o) => [o.need.id, o.pieces.map((p) => p.id)])).toEqual([["n1", ["a", "b"]]]);
    expect(allocate(needs, pieces, { rentalHouseId: "RH-A", date: "2026-11-17" })).toEqual([]);
  });
});
