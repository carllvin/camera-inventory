/** Deleting projects: archived (never removed), refused while equipment is on it, restorable and undoable. */
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as s from "../src/server/db/schema";
import type { Ctx } from "../src/server/domain/context";
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
});
