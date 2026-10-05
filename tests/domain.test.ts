/** Phase 3 domain services: every change is validated, isolated per workspace and audited. */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/server/db/schema";
import { DomainError, type Ctx } from "../src/server/domain/context";
import { createCategory, getCategoryTree, updateCategory } from "../src/server/domain/categories";
import {
  assignToProject,
  changeCondition,
  changeStatus,
  createItem,
  findItemByCode,
  getItemDetail,
  listItems,
  removeFromProject,
  updateItem,
} from "../src/server/domain/equipment-items";
import { createEquipmentType, listEquipmentTypes } from "../src/server/domain/equipment-types";
import { createProject, getProjectSummary, updateProject } from "../src/server/domain/projects";
import { createRentalHouse } from "../src/server/domain/rental-houses";
import { globalSearch } from "../src/server/domain/search";
import { client, db, makeFixture, type Fixture } from "./helpers/db";

let f: Fixture;
let ctx: Ctx;

beforeAll(async () => {
  f = await makeFixture();
  ctx = { workspaceId: f.ws.id, userId: f.user.id, role: "owner" };
});

afterAll(async () => {
  await client.end();
});

async function expectDomainError(p: Promise<unknown>, code: DomainError["code"], fragment?: string) {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
  if (fragment) expect((err as DomainError).message).toContain(fragment);
  return err as DomainError;
}

async function eventsFor(itemId: string) {
  return db.select().from(s.auditEvent).where(eq(s.auditEvent.equipmentItemId, itemId)).orderBy(s.auditEvent.id);
}

describe("equipment items", () => {
  it("creates an off-project item with a history event", async () => {
    const item = await createItem(db, ctx, { equipmentTypeId: f.camType.id, serialNumber: "D-1001", rentalHouseId: f.rentalHouse.id });
    expect(item).toMatchObject({ status: "available", projectId: null, quantity: 1 });
    const events = await eventsFor(item.id);
    expect(events.map((e) => e.action)).toEqual(["equipment_item.created"]);
    expect(events[0]!.actorUserId).toBe(f.user.id);
  });

  it("creates an item directly on a project (assignment + rental-house link + events)", async () => {
    const item = await createItem(db, ctx, {
      equipmentTypeId: f.camType.id,
      serialNumber: "D-1002",
      rentalHouseId: f.rentalHouse.id,
      projectId: f.project.id,
    });
    expect(item).toMatchObject({ status: "on_project", projectId: f.project.id });
    const [link] = await db
      .select()
      .from(s.projectRentalHouse)
      .where(and(eq(s.projectRentalHouse.projectId, f.project.id), eq(s.projectRentalHouse.rentalHouseId, f.rentalHouse.id)));
    expect(link).toBeDefined();
    expect((await eventsFor(item.id)).map((e) => e.action)).toEqual(["equipment_item.created", "equipment_item.assigned_to_project"]);
  });

  it("rejects duplicate serials with a pointer to the existing item (never merges)", async () => {
    const first = await createItem(db, ctx, { equipmentTypeId: f.camType.id, serialNumber: "DUP-77" });
    const err = await expectDomainError(createItem(db, ctx, { equipmentTypeId: f.camType.id, serialNumber: "dup-77" }), "CONFLICT", "never merged");
    expect(err.details?.existingItemId).toBe(first.id);
  });

  it("serialized items must have quantity 1", async () => {
    await expectDomainError(createItem(db, ctx, { equipmentTypeId: f.camType.id, quantity: 4 }), "VALIDATION");
    const bulk = await createItem(db, ctx, { equipmentTypeId: f.cableType.id, quantity: 20 });
    expect(bulk).toMatchObject({ trackingMode: "bulk", quantity: 20 });
  });

  it("assigns to one project only; must be removed before moving", async () => {
    const item = await createItem(db, ctx, { equipmentTypeId: f.camType.id, serialNumber: "MOVE-9" });
    await assignToProject(db, ctx, item.id, { projectId: f.project.id });
    await expectDomainError(assignToProject(db, ctx, item.id, { projectId: f.project2.id }), "CONFLICT", "still on Project A");
    await removeFromProject(db, ctx, item.id, { reason: "Added to the wrong project" });
    await assignToProject(db, ctx, item.id, { projectId: f.project2.id });
    const detail = await getItemDetail(db, ctx, item.id);
    expect(detail.item.projectId).toBe(f.project2.id);
    expect(detail.assignments).toHaveLength(2);
    expect(detail.assignments.find((a) => a.project_id === f.project.id)?.end_reason).toBe("removed");
    expect(detail.timeline.map((e) => e.action)).toContain("equipment_item.removed_from_project");
  });

  it("changes status only while on a project and records from → to", async () => {
    const off = await createItem(db, ctx, { equipmentTypeId: f.camType.id, serialNumber: "ST-1" });
    await expectDomainError(changeStatus(db, ctx, off.id, { status: "in_use" }), "VALIDATION");
    await assignToProject(db, ctx, off.id, { projectId: f.project.id });
    await changeStatus(db, ctx, off.id, { status: "missing", note: "Not on cart at wrap" });
    const events = await eventsFor(off.id);
    const last = events.at(-1)!;
    expect(last.action).toBe("equipment_item.status_changed");
    expect(last.changes).toEqual({ status: { from: "on_project", to: "missing" } });
    expect(last.metadata).toEqual({ note: "Not on cart at wrap" });
  });

  it("changes condition anywhere, and detects concurrent edits via version", async () => {
    const item = await createItem(db, ctx, { equipmentTypeId: f.camType.id, serialNumber: "COND-1" });
    await changeCondition(db, ctx, item.id, { condition: "damaged", expectedVersion: item.version });
    await expectDomainError(changeCondition(db, ctx, item.id, { condition: "ok", expectedVersion: item.version }), "CONFLICT", "changed by someone else");
  });

  it("updates identifiers with a field diff", async () => {
    const item = await createItem(db, ctx, { equipmentTypeId: f.camType.id, serialNumber: "UPD-1" });
    await updateItem(db, ctx, item.id, { serialNumber: "UPD-1", assetNumber: "AR-5", notes: "Gaffer tape on handle" });
    const last = (await eventsFor(item.id)).at(-1)!;
    expect(last.action).toBe("equipment_item.updated");
    expect(last.changes).toEqual({ assetNumber: { from: null, to: "AR-5" }, notes: { from: null, to: "Gaffer tape on handle" } });
  });

  it("filters project equipment by category (including subcategories), rental house, status", async () => {
    const lenses = await createCategory(db, ctx, { name: "Lenses" });
    const spherical = await createCategory(db, ctx, { name: "Spherical", parentId: lenses.id });
    const lensType = await createEquipmentType(db, ctx, { manufacturer: "ARRI", model: "Signature Prime 35", categoryId: spherical.id });
    const lens = await createItem(db, ctx, { equipmentTypeId: lensType.id, serialNumber: "SP-1", projectId: f.project.id, rentalHouseId: f.rentalHouse.id });
    const byCategory = await listItems(db, ctx, { projectId: f.project.id, categoryId: lenses.id });
    expect(byCategory.map((r) => r.id)).toEqual([lens.id]);
    const missing = await listItems(db, ctx, { projectId: f.project.id, status: "missing" });
    expect(missing.every((r) => r.status === "missing")).toBe(true);
    const owned = await listItems(db, ctx, { rentalHouseId: "owned" });
    expect(owned.every((r) => r.rentalHouseId === null)).toBe(true);
    const summary = await getProjectSummary(db, ctx, f.project.id);
    expect(summary.rentalHouses.map((r) => r.id)).toContain(f.rentalHouse.id);
  });

  it("finds items by barcode / serial / asset for the scanner", async () => {
    const item = await createItem(db, ctx, { equipmentTypeId: f.camType.id, serialNumber: "SCAN-1", barcode: "QR-000123" });
    expect((await findItemByCode(db, ctx, "QR-000123")).map((r) => r.id)).toEqual([item.id]);
    expect((await findItemByCode(db, ctx, "scan-1")).map((r) => r.id)).toEqual([item.id]);
  });
});

describe("workspace isolation and permissions", () => {
  it("cannot read or change another workspace's data", async () => {
    const other = await makeFixture();
    const otherCtx: Ctx = { workspaceId: other.ws.id, userId: other.user.id, role: "owner" };
    const mine = await createItem(db, ctx, { equipmentTypeId: f.camType.id, serialNumber: "ISO-1" });
    await expectDomainError(getItemDetail(db, otherCtx, mine.id), "NOT_FOUND");
    await expectDomainError(changeCondition(db, otherCtx, mine.id, { condition: "damaged" }), "NOT_FOUND");
    // Using a foreign equipment type or project is refused.
    await expectDomainError(createItem(db, otherCtx, { equipmentTypeId: f.camType.id }), "NOT_FOUND");
    const theirs = await createItem(db, otherCtx, { equipmentTypeId: other.camType.id });
    await expectDomainError(assignToProject(db, otherCtx, theirs.id, { projectId: f.project.id }), "NOT_FOUND");
    // Lists and search never leak.
    expect((await listItems(db, otherCtx, {})).some((r) => r.id === mine.id)).toBe(false);
    expect((await globalSearch(db, otherCtx, "ISO-1")).length).toBe(0);
  });

  it("viewers cannot change anything; only admins edit categories", async () => {
    const viewer: Ctx = { ...ctx, role: "viewer" };
    const member: Ctx = { ...ctx, role: "member" };
    await expectDomainError(createItem(db, viewer, { equipmentTypeId: f.camType.id }), "FORBIDDEN");
    await expectDomainError(createProject(db, viewer, { name: "Nope" }), "FORBIDDEN");
    await expectDomainError(createCategory(db, member, { name: "Nope" }), "FORBIDDEN");
  });
});

describe("projects, rental houses, categories, types", () => {
  it("creates and updates projects with audit and friendly errors", async () => {
    const p = await createProject(db, ctx, { name: "Pilot Episode", status: "planning", startDate: "2026-11-01" });
    await expectDomainError(createProject(db, ctx, { name: "pilot episode" }), "CONFLICT");
    await expectDomainError(updateProject(db, ctx, p.id, { name: "Pilot Episode", startDate: "2026-11-10", endDate: "2026-11-01" }), "VALIDATION");
    await updateProject(db, ctx, p.id, { name: "Pilot Episode", status: "prep", startDate: "2026-11-01" });
    const events = await db.select().from(s.auditEvent).where(eq(s.auditEvent.projectId, p.id)).orderBy(s.auditEvent.id);
    expect(events.map((e) => e.action)).toEqual(["project.created", "project.status_changed"]);
  });

  it("rental house names are unique; aliases are parsed from text", async () => {
    const rh = await createRentalHouse(db, ctx, { name: "Cine Rent", aliases: "CineRent, Cine-Rent GmbH" });
    expect(rh.aliases).toEqual(["CineRent", "Cine-Rent GmbH"]);
    await expectDomainError(createRentalHouse(db, ctx, { name: "cine rent" }), "CONFLICT");
  });

  it("category tree can be edited but not made cyclic", async () => {
    const a = await createCategory(db, ctx, { name: "Support" });
    const b = await createCategory(db, ctx, { name: "Heads", parentId: a.id });
    await expectDomainError(updateCategory(db, ctx, a.id, { name: "Support", parentId: b.id }), "VALIDATION");
    await updateCategory(db, ctx, b.id, { name: "Fluid Heads", parentId: a.id });
    const { flat } = await getCategoryTree(db, ctx);
    expect(flat.find((c) => c.id === b.id)?.path).toBe("Support › Fluid Heads");
  });

  it("equipment types: duplicates rejected, specs parsed, alias search", async () => {
    const t = await createEquipmentType(db, ctx, {
      manufacturer: "Teradek",
      model: "Bolt 6 XT 750 TX",
      aliases: "Bolt TX, Teradek TX",
      specs: "range: 750 ft\nlatency: <1 ms",
    });
    expect(t.name).toBe("Teradek Bolt 6 XT 750 TX");
    expect(t.specs).toEqual({ range: "750 ft", latency: "<1 ms" });
    await expectDomainError(createEquipmentType(db, ctx, { manufacturer: "teradek", model: "bolt 6 xt 750 tx" }), "CONFLICT");
    expect((await listEquipmentTypes(db, ctx, { q: "bolt tx" })).map((x) => x.id)).toContain(t.id);
  });
});

describe("global search", () => {
  it("finds items by alias, typo, compact serial; also projects and rental houses", async () => {
    const item = await createItem(db, ctx, { equipmentTypeId: f.camType.id, serialNumber: "SN-77 812", projectId: f.project.id });
    const kinds = async (q: string) => (await globalSearch(db, ctx, q)).map((h) => `${h.kind}:${h.id}`);
    expect(await kinds("sn77812")).toContain(`item:${item.id}`);
    expect(await kinds("A35")).toContain(`type:${f.camType.id}`);
    expect(await kinds("alexxa 35")).toContain(`type:${f.camType.id}`);
    expect(await kinds("project a")).toContain(`project:${f.project.id}`);
    expect(await kinds("rental co")).toContain(`rental_house:${f.rentalHouse.id}`);
  });
});
