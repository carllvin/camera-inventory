import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "../db/client";
import * as s from "../db/schema";
import type { Ctx, WorkspaceRole } from "../domain/context";
import { auth } from "./auth";

export interface SessionCtx extends Ctx {
  user: { id: string; name: string; email: string };
  workspaceName: string;
}

/** Current session user (or null). Cached per request. */
export const getSessionUser = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() });
  return session ? { user: session.user, session: session.session } : null;
});

/**
 * Resolve user + workspace + role for the current request, redirecting to
 * login / onboarding when needed. Every page and server action starts here.
 */
export const getCtx = cache(async (): Promise<SessionCtx> => {
  const current = await getSessionUser();
  if (!current) redirect("/login");
  const db = getDb();
  const preferred = (current.session as { activeWorkspaceId?: string | null }).activeWorkspaceId ?? null;
  const memberships = await db
    .select({ workspaceId: s.workspaceMember.workspaceId, role: s.workspaceMember.role, name: s.workspace.name })
    .from(s.workspaceMember)
    .innerJoin(s.workspace, eq(s.workspace.id, s.workspaceMember.workspaceId))
    .where(eq(s.workspaceMember.userId, current.user.id))
    .orderBy(asc(s.workspaceMember.createdAt));
  const m = memberships.find((x) => x.workspaceId === preferred) ?? memberships[0];
  if (!m) redirect("/onboarding");
  return {
    workspaceId: m.workspaceId,
    userId: current.user.id,
    role: m.role as WorkspaceRole,
    workspaceName: m.name,
    user: { id: current.user.id, name: current.user.name, email: current.user.email },
  };
});

export async function userHasWorkspace(userId: string) {
  const [m] = await getDb()
    .select({ id: s.workspaceMember.workspaceId })
    .from(s.workspaceMember)
    .where(and(eq(s.workspaceMember.userId, userId)))
    .limit(1);
  return Boolean(m);
}
