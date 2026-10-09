/** Deleting equipment types: archived (never removed), blocked while pieces are on a project, undoable. */
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as s from "../src/server/db/schema";
import type { Ctx } from "../src/server/domain/context";
import { findType } from "../src/server/domain/document-matching";
import { createEquipmentType, deleteEquipmentTypes, listEquipmentTypes, restoreEquipmentType } from "../src/server/domain/equipment-types";
import { revertEvent } from "../src/server/domain/revert";
import { importStandardCatalog } from "../src/server/domain/standard-catalog";
import { client, db, itemOnProject, makeFixture } from "./helpers/db";

afterAll(async () => {
  await client.end();
});

async function setup() {
  const f = await makeFixture();
  const ctx: Ctx = { workspaceId: f.ws.id, userId: f.user.id, role: "owner" };
  return { f, ctx };
}

describe("deleting equipment types", () => {
  it("is refused while pieces are on a project; past pieces keep their type", async () => {
    const { f, ctx } = await setup();
    const item = await itemOnProject(f, { serialNumber: "DEL-1" });
    await expect(deleteEquipmentTypes(db, ctx, [f.camType.id])).rejects.toThrow(/Still in use: ARRI ALEXA 35 \(1 on a project\)/);
    // Off the project (returned): now it may go; the item keeps its type.
    await db.transaction(async (tx) => {
      await tx.update(s.projectAssignment).set({ endedAt: new Date(), endReason: "returned" }).where(eq(s.projectAssignment.equipmentItemId, item.id));
      await tx.update(s.equipmentItem).set({ projectId: null, status: "returned" }).where(eq(s.equipmentItem.id, item.id));
    });
    expect((await deleteEquipmentTypes(db, ctx, [f.camType.id])).deleted).toEqual(["ARRI ALEXA 35"]);
    const [still] = await db.select().from(s.equipmentItem).where(eq(s.equipmentItem.id, item.id));
    expect(still!.equipmentTypeId).toBe(f.camType.id);
  });

  it("hides the type from lists and matching; undo, restore and re-creating bring it back", async () => {
    const { f, ctx } = await setup();
    const { deleted } = await deleteEquipmentTypes(db, ctx, [f.camType.id, f.cableType.id]);
    expect(deleted).toHaveLength(2);
    expect((await listEquipmentTypes(db, ctx, {})).map((t) => t.id)).not.toContain(f.camType.id);
    expect(await findType(db, ctx.workspaceId, { catalogMatch: "ARRI ALEXA 35", description: "ALEXA 35", manufacturer: "ARRI", model: "ALEXA 35" })).toBeNull();

    // Undo from the history.
    const [ev] = await db.select().from(s.auditEvent).where(and(eq(s.auditEvent.entityId, f.camType.id), eq(s.auditEvent.action, "equipment_type.archived")));
    await revertEvent(db, ctx, ev!.id);
    expect((await listEquipmentTypes(db, ctx, {})).map((t) => t.id)).toContain(f.camType.id);

    // Restore button.
    await restoreEquipmentType(db, ctx, f.cableType.id);
    const [cable] = await db.select().from(s.equipmentType).where(eq(s.equipmentType.id, f.cableType.id));
    expect(cable!.archivedAt).toBeNull();

    // Creating a deleted type again revives it instead of failing on the name.
    await deleteEquipmentTypes(db, ctx, [f.cableType.id]);
    const again = await createEquipmentType(db, ctx, { manufacturer: "Generic", model: "BNC 1m", defaultTrackingMode: "bulk" });
    expect(again.id).toBe(f.cableType.id);
    expect(again.archivedAt).toBeNull();
  });

  it("the standard catalog import does not bring a deleted type back", async () => {
    const { ctx } = await setup();
    await importStandardCatalog(db, ctx, { sections: ["cameras"] });
    const [mini] = await db.select().from(s.equipmentType).where(and(eq(s.equipmentType.workspaceId, ctx.workspaceId), eq(s.equipmentType.model, "ALEXA Mini LF")));
    await deleteEquipmentTypes(db, ctx, [mini!.id]);
    await importStandardCatalog(db, ctx, { sections: ["cameras"] });
    const rows = await db.select().from(s.equipmentType).where(and(eq(s.equipmentType.workspaceId, ctx.workspaceId), eq(s.equipmentType.model, "ALEXA Mini LF")));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.archivedAt).not.toBeNull();
  });
});
