import { randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import { DomainError, requireRole, type Ctx } from "./context";
import { requiredText } from "./validation";

/** Default category tree for a new workspace (fully editable afterwards). */
export const DEFAULT_CATEGORIES: Record<string, string[]> = {
  Camera: ["Camera Bodies", "Viewfinders", "Camera Accessories", "Video Assist"],
  Lenses: ["Spherical", "Anamorphic", "Zoom"],
  Support: ["Tripods", "Heads", "Gimbals"],
  Electronics: ["Monitors", "Wireless", "Timecode", "Lens Control"],
  Power: ["Batteries", "Chargers"],
  Grip: ["Stands", "Rigging"],
  Cables: [],
};

export const workspaceInput = z.object({ name: requiredText(120) });

function slugify(name: string) {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
  return `${base || "workspace"}-${randomBytes(3).toString("hex")}`;
}

/** Create a workspace with the given user as owner and a starter category tree. */
export async function createWorkspace(db: DbOrTx, userId: string, input: z.input<typeof workspaceInput>) {
  const { name } = workspaceInput.parse(input);
  return db.transaction(async (tx) => {
    const [w] = await tx.insert(s.workspace).values({ name, slug: slugify(name) }).returning();
    await tx.insert(s.workspaceMember).values({ workspaceId: w!.id, userId, role: "owner" });
    let rootOrder = 0;
    for (const [root, children] of Object.entries(DEFAULT_CATEGORIES)) {
      const [r] = await tx
        .insert(s.category)
        .values({ workspaceId: w!.id, name: root, sortOrder: rootOrder++ })
        .returning();
      let order = 0;
      for (const child of children) {
        await tx.insert(s.category).values({ workspaceId: w!.id, parentId: r!.id, name: child, sortOrder: order++ });
      }
    }
    return w!;
  });
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export const renameWorkspaceInput = z.object({ name: requiredText(120) });

export async function renameWorkspace(db: DbOrTx, ctx: Ctx, input: z.input<typeof renameWorkspaceInput>) {
  requireRole(ctx, "admin");
  const { name } = renameWorkspaceInput.parse(input);
  await db.update(s.workspace).set({ name }).where(eq(s.workspace.id, ctx.workspaceId));
}

export const addMemberInput = z.object({
  name: z.string().trim().max(120).optional(),
  email: z.email("Enter a valid email address").transform((e) => e.toLowerCase()),
  role: z.enum(["admin", "member", "viewer"]),
  password: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(8, "At least 8 characters").max(128).optional()),
});

/**
 * Add a person to the workspace. Existing accounts are added directly; for new
 * people the admin sets a temporary password to hand over.
 */
export async function addMember(db: DbOrTx, ctx: Ctx, input: z.input<typeof addMemberInput>) {
  requireRole(ctx, "admin");
  const data = addMemberInput.parse(input);
  return db.transaction(async (tx) => {
    let [u] = await tx.select().from(s.user).where(sql`lower(${s.user.email}) = ${data.email}`);
    if (!u) {
      if (!data.name) throw new DomainError("VALIDATION", "This person has no account yet — enter their name and a temporary password.");
      if (!data.password) throw new DomainError("VALIDATION", "Set a temporary password for the new account.");
      [u] = await tx.insert(s.user).values({ name: data.name, email: data.email, emailVerified: false }).returning();
      await tx.insert(s.account).values({ userId: u!.id, accountId: u!.id, providerId: "credential", password: await hashPassword(data.password) });
    }
    const inserted = await tx
      .insert(s.workspaceMember)
      .values({ workspaceId: ctx.workspaceId, userId: u!.id, role: data.role })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) throw new DomainError("CONFLICT", `${u!.name} is already a member.`);
    return u!;
  });
}

export async function changeMemberRole(db: DbOrTx, ctx: Ctx, userId: string, role: "owner" | "admin" | "member" | "viewer") {
  requireRole(ctx, "admin");
  if (role === "owner") requireRole(ctx, "owner");
  return db.transaction(async (tx) => {
    const [m] = await tx
      .select()
      .from(s.workspaceMember)
      .where(and(eq(s.workspaceMember.workspaceId, ctx.workspaceId), eq(s.workspaceMember.userId, userId)));
    if (!m) throw new DomainError("NOT_FOUND", "Member not found.");
    if (m.role === "owner" && ctx.role !== "owner") throw new DomainError("FORBIDDEN", "Only an owner can change another owner's role.");
    if (m.role === "owner" && role !== "owner") {
      const [{ n }] = (await tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM workspace_member WHERE workspace_id = ${ctx.workspaceId} AND role = 'owner'`,
      )) as unknown as [{ n: number }];
      if (n <= 1) throw new DomainError("VALIDATION", "A workspace needs at least one owner.");
    }
    await tx
      .update(s.workspaceMember)
      .set({ role })
      .where(and(eq(s.workspaceMember.workspaceId, ctx.workspaceId), eq(s.workspaceMember.userId, userId)));
  });
}
