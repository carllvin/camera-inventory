/** Undo from the history: opposite change through the normal rules, recorded as new events. */
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/server/db/schema";
import { createCase, packItem } from "../src/server/domain/cases";
import type { Ctx } from "../src/server/domain/context";
import { changeCondition, changeStatus, updateItem } from "../src/server/domain/equipment-items";
import { removeEquipment } from "../src/server/domain/project-removal";
import { revertEvent, withUndo } from "../src/server/domain/revert";
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

async function lastEvent(itemId: string, action: (typeof s.AUDIT_ACTIONS)[number]) {
  const [e] = await db
    .select()
    .from(s.auditEvent)
    .where(and(eq(s.auditEvent.equipmentItemId, itemId), eq(s.auditEvent.action, action)))
    .orderBy(sql`${s.auditEvent.id} DESC`)
    .limit(1);
  return e!;
}
const get = async (id: string) => (await db.select().from(s.equipmentItem).where(eq(s.equipmentItem.id, id)))[0]!;

describe("undo from the history", () => {
  it("undoes status, condition, set and edits; marks the original; refuses twice", async () => {
    const it1 = await itemOnProject(f, { serialNumber: `U1-${Date.now()}` });
    await changeStatus(db, ctx, it1.id, { status: "in_use" });
    const statusEvent = await lastEvent(it1.id, "equipment_item.status_changed");
    await revertEvent(db, ctx, statusEvent.id);
    expect((await get(it1.id)).status).toBe("on_project");
    const undo = await lastEvent(it1.id, "equipment_item.status_changed");
    expect(undo.summary).toMatch(/^Undo: /);
    expect(undo.metadata).toMatchObject({ revertOf: statusEvent.id });
    await expect(revertEvent(db, ctx, statusEvent.id)).rejects.toThrow(/undone already/);
    const [marked] = await withUndo(db, ctx, [{ ...statusEvent, changes: statusEvent.changes as never, metadata: statusEvent.metadata as never }]);
    expect(marked!.undo).toBe("done");
    // The undo itself has no Undo button.
    expect((await withUndo(db, ctx, [{ ...undo, changes: undo.changes as never, metadata: undo.metadata as never }]))[0]!.undo).toBeNull();

    await changeCondition(db, ctx, it1.id, { condition: "damaged" });
    await revertEvent(db, ctx, (await lastEvent(it1.id, "equipment_item.condition_changed")).id);
    expect((await get(it1.id)).condition).toBe("unknown");

    const c1 = await createCase(db, ctx, { name: `U-A ${Date.now()}`, projectId: f.project.id });
    const c2 = await createCase(db, ctx, { name: `U-B ${Date.now()}`, projectId: f.project.id });
    await packItem(db, ctx, c1.id, it1.id);
    await packItem(db, ctx, c2.id, it1.id, { allowMove: true });
    await revertEvent(db, ctx, (await lastEvent(it1.id, "equipment_item.added_to_case")).id);
    expect((await get(it1.id)).caseId).toBe(c1.id); // back into the first set

    await updateItem(db, ctx, it1.id, { serialNumber: `U1x-${Date.now()}`, notes: "scratched" });
    await revertEvent(db, ctx, (await lastEvent(it1.id, "equipment_item.updated")).id);
    expect(await get(it1.id)).toMatchObject({ serialNumber: it1.serialNumber, notes: null });
  });

  it("refuses when the value changed again since, and restores a removal from the project", async () => {
    const it2 = await itemOnProject(f, { serialNumber: `U2-${Date.now()}` });
    await changeStatus(db, ctx, it2.id, { status: "in_use" });
    const first = await lastEvent(it2.id, "equipment_item.status_changed");
    await changeStatus(db, ctx, it2.id, { status: "missing" });
    await expect(revertEvent(db, ctx, first.id)).rejects.toThrow(/changed again since/);

    await removeEquipment(db, ctx, { projectId: f.project.id, reason: "returned" }, { items: [{ id: it2.id }] });
    expect((await get(it2.id)).projectId).toBeNull();
    await revertEvent(db, ctx, (await lastEvent(it2.id, "equipment_item.returned")).id);
    expect(await get(it2.id)).toMatchObject({ projectId: f.project.id, status: "on_project" });
  });

  it("restores an equipment type's aliases", async () => {
    const [type] = await db.select().from(s.equipmentType).where(eq(s.equipmentType.id, f.camType.id));
    await db.transaction(async (tx) => {
      const { recordEvent } = await import("../src/server/domain/audit");
      await tx.update(s.equipmentType).set({ aliases: [...type!.aliases, "Kamera 35"] }).where(eq(s.equipmentType.id, type!.id));
      await recordEvent(tx, ctx, { action: "equipment_type.alias_learned", entityType: "equipment_type", entityId: type!.id, summary: "alias", changes: { aliases: { from: type!.aliases, to: [...type!.aliases, "Kamera 35"] } } });
    });
    const [e] = await db.select().from(s.auditEvent).where(and(eq(s.auditEvent.entityId, type!.id), eq(s.auditEvent.action, "equipment_type.alias_learned")));
    await revertEvent(db, ctx, e!.id);
    expect((await db.select().from(s.equipmentType).where(eq(s.equipmentType.id, type!.id)))[0]!.aliases).toEqual(type!.aliases);
  });
});
