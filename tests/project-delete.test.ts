/** Deleting projects: archived (never removed), refused while equipment is on it, restorable and undoable. */
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as s from "../src/server/db/schema";
import type { Ctx } from "../src/server/domain/context";
import { createCase, listCases, packItem } from "../src/server/domain/cases";
import { listItems } from "../src/server/domain/equipment-items";
import { listDocuments } from "../src/server/domain/overview";
import { deleteProject, listDeletedProjects, listProjects, restoreProject } from "../src/server/domain/projects";
import { revertEvent } from "../src/server/domain/revert";
import { client, db, itemOnProject, makeFixture } from "./helpers/db";

afterAll(async () => {
  await client.end();
});

describe("deleting projects", () => {
  it("is refused while equipment is on the project, and only for admins", async () => {
    const f = await makeFixture();
    const ctx: Ctx = { workspaceId: f.ws.id, userId: f.user.id, role: "owner" };
    await itemOnProject(f, { serialNumber: "PD-1" });
    await expect(deleteProject(db, ctx, f.project.id)).rejects.toThrow(/still has 1 piece/);
    await expect(deleteProject(db, { ...ctx, role: "member" }, f.project2.id)).rejects.toThrow();
  });

  it("hides the project; restore and undo bring it back", async () => {
    const f = await makeFixture();
    const ctx: Ctx = { workspaceId: f.ws.id, userId: f.user.id, role: "owner" };
    await deleteProject(db, ctx, f.project2.id);
    expect((await listProjects(db, ctx)).map((p) => p.id)).not.toContain(f.project2.id);
    expect((await listDeletedProjects(db, ctx)).map((p) => p.id)).toEqual([f.project2.id]);

    await restoreProject(db, ctx, f.project2.id);
    expect((await listProjects(db, ctx)).map((p) => p.id)).toContain(f.project2.id);

    await deleteProject(db, ctx, f.project2.id);
    const [ev] = await db
      .select()
      .from(s.auditEvent)
      .where(and(eq(s.auditEvent.entityId, f.project2.id), eq(s.auditEvent.action, "project.archived")))
      .orderBy(s.auditEvent.id);
    const events = await db.select().from(s.auditEvent).where(and(eq(s.auditEvent.entityId, f.project2.id), eq(s.auditEvent.action, "project.archived")));
    await revertEvent(db, ctx, events.at(-1)!.id);
    expect(ev).toBeTruthy();
    expect((await listProjects(db, ctx)).map((p) => p.id)).toContain(f.project2.id);
  });

  it("can return everything first: items go back, sets close, the project's sets and documents leave the lists", async () => {
    const f = await makeFixture();
    const ctx: Ctx = { workspaceId: f.ws.id, userId: f.user.id, role: "owner" };
    const rented = await itemOnProject(f, { serialNumber: "PD-R" });
    const owned = await itemOnProject(f, { serialNumber: "PD-O", rentalHouseId: null });
    const set = await createCase(db, ctx, { projectId: f.project.id, name: "A-Cam" });
    await packItem(db, ctx, set.id, rented.id);
    await db.insert(s.document).values({ workspaceId: f.ws.id, kind: "delivery_note", projectId: f.project.id, title: "LS 1" });
    expect((await listCases(db, ctx)).map((c) => c.id)).toContain(set.id);

    await deleteProject(db, ctx, f.project.id, { returnEquipment: true });
    const status = async (id: string) => (await db.select().from(s.equipmentItem).where(eq(s.equipmentItem.id, id)))[0]!;
    expect(await status(rented.id)).toMatchObject({ status: "returned", projectId: null, caseId: null });
    expect(await status(owned.id)).toMatchObject({ status: "available", projectId: null });
    // Gone from the general lists; still there on the project itself.
    expect((await listCases(db, ctx)).map((c) => c.id)).not.toContain(set.id);
    expect((await listDocuments(db, ctx)).filter((d) => d.projectId === f.project.id)).toHaveLength(0);
    expect(await listDocuments(db, ctx, { projectId: f.project.id })).toHaveLength(1);
    // Returned equipment is hidden unless asked for; own equipment back at base stays visible.
    const shown = (await listItems(db, ctx, { hideReturned: true })).map((i) => i.id);
    expect(shown).toContain(owned.id);
    expect(shown).not.toContain(rented.id);
    expect((await listItems(db, ctx, { hideReturned: true, status: "returned" })).map((i) => i.id)).toContain(rented.id);
  });
});
