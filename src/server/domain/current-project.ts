/**
 * The "current project": most of the time one project is active, and the UI
 * focuses on it (equipment list, header). The user can switch (kept in a cookie);
 * without a choice the app picks the active project - shooting first, then prep,
 * wrap and planning, newest start date first.
 */
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import type { Ctx } from "./context";

export const CURRENT_PROJECT_COOKIE = "ci_project";
/** Cookie value meaning "show everything, no current project". */
export const ALL_PROJECTS = "all";

export async function listActiveProjects(db: DbOrTx, ctx: Ctx) {
  return db
    .select({ id: s.project.id, name: s.project.name, code: s.project.code, status: s.project.status })
    .from(s.project)
    .where(and(eq(s.project.workspaceId, ctx.workspaceId), isNull(s.project.archivedAt), ne(s.project.status, "closed")))
    .orderBy(
      sql`CASE ${s.project.status} WHEN 'shooting' THEN 0 WHEN 'prep' THEN 1 WHEN 'wrap' THEN 2 ELSE 3 END`,
      sql`${s.project.startDate} DESC NULLS LAST`,
      asc(s.project.name),
    );
}

export type ActiveProject = Awaited<ReturnType<typeof listActiveProjects>>[number];

/** The project the UI focuses on, or null for "all projects" / no active project. */
export async function resolveCurrentProject(db: DbOrTx, ctx: Ctx, cookieValue: string | undefined) {
  const active = await listActiveProjects(db, ctx);
  if (cookieValue === ALL_PROJECTS) return { current: null, active, explicitAll: true };
  const chosen = cookieValue ? active.find((p) => p.id === cookieValue) : undefined;
  return { current: chosen ?? active[0] ?? null, active, explicitAll: false };
}
