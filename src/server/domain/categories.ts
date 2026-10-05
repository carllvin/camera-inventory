import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import { recordEvent } from "./audit";
import { DomainError, notFound, pgErrorOf, requireRole, type Ctx } from "./context";
import { optionalUuid, requiredText } from "./validation";

export interface CategoryNode {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  depth: number;
  /** "Camera › Camera Bodies" */
  path: string;
  typeCount: number;
  children: CategoryNode[];
}

/** Whole tree, plus a flat depth-first list (handy for <select> options). */
export async function getCategoryTree(db: DbOrTx, ctx: Ctx) {
  const rows = await db
    .select({
      id: s.category.id,
      name: s.category.name,
      parentId: s.category.parentId,
      sortOrder: s.category.sortOrder,
      typeCount: sql<number>`(SELECT count(*)::int FROM equipment_type t WHERE t.category_id = "category"."id")`,
    })
    .from(s.category)
    .where(eq(s.category.workspaceId, ctx.workspaceId))
    .orderBy(asc(s.category.sortOrder), asc(s.category.name));

  const byParent = new Map<string | null, typeof rows>();
  for (const r of rows) {
    const list = byParent.get(r.parentId) ?? [];
    list.push(r);
    byParent.set(r.parentId, list);
  }
  const flat: CategoryNode[] = [];
  const build = (parentId: string | null, depth: number, prefix: string): CategoryNode[] =>
    (byParent.get(parentId) ?? []).map((r) => {
      const path = prefix ? `${prefix} › ${r.name}` : r.name;
      const node: CategoryNode = { ...r, depth, path, children: [] };
      flat.push(node);
      node.children = build(r.id, depth + 1, path);
      return node;
    });
  const roots = build(null, 0, "");
  return { roots, flat };
}

/** The category and all its descendants (for "filter by Lenses" including Spherical, Zoom …). */
export async function categoryWithDescendants(db: DbOrTx, ctx: Ctx, id: string): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE tree AS (
      SELECT id FROM category WHERE id = ${id} AND workspace_id = ${ctx.workspaceId}
      UNION ALL
      SELECT c.id FROM category c JOIN tree t ON c.parent_id = t.id
    ) SELECT id FROM tree`);
  return rows.map((r) => r.id);
}

export const categoryInput = z.object({
  name: requiredText(80),
  parentId: optionalUuid,
  sortOrder: z.coerce.number().int().min(0).max(10000).optional(),
});

function mapErr(err: unknown, name: string): never {
  const pg = pgErrorOf(err);
  if (pg?.code === "23505") throw new DomainError("CONFLICT", `A category named “${name}” already exists here.`);
  if (pg?.code === "23514") throw new DomainError("VALIDATION", "A category cannot be moved below one of its own subcategories.");
  if (pg?.code === "23503") throw new DomainError("VALIDATION", "Parent category not found.");
  throw err;
}

export async function createCategory(db: DbOrTx, ctx: Ctx, input: z.input<typeof categoryInput>) {
  requireRole(ctx, "admin");
  const data = categoryInput.parse(input);
  try {
    return await db.transaction(async (tx) => {
      const [c] = await tx
        .insert(s.category)
        .values({ workspaceId: ctx.workspaceId, name: data.name, parentId: data.parentId ?? null, sortOrder: data.sortOrder ?? 0 })
        .returning();
      await recordEvent(tx, ctx, {
        action: "category.created",
        entityType: "category",
        entityId: c!.id,
        summary: `Category ${c!.name} created`,
        metadata: { parentId: c!.parentId },
      });
      return c!;
    });
  } catch (err) {
    mapErr(err, data.name);
  }
}

/** Rename and/or move a category. */
export async function updateCategory(db: DbOrTx, ctx: Ctx, id: string, input: z.input<typeof categoryInput>) {
  requireRole(ctx, "admin");
  const data = categoryInput.parse(input);
  try {
    return await db.transaction(async (tx) => {
      const [prev] = await tx
        .select()
        .from(s.category)
        .where(and(eq(s.category.id, id), eq(s.category.workspaceId, ctx.workspaceId)));
      if (!prev) notFound("Category");
      const parentId = data.parentId ?? null;
      const [c] = await tx
        .update(s.category)
        .set({ name: data.name, parentId, sortOrder: data.sortOrder ?? prev.sortOrder })
        .where(eq(s.category.id, id))
        .returning();
      const moved = prev.parentId !== parentId;
      if (prev.name !== data.name || moved || prev.sortOrder !== c!.sortOrder) {
        await recordEvent(tx, ctx, {
          action: moved ? "category.moved" : "category.updated",
          entityType: "category",
          entityId: id,
          summary: moved ? `Category ${c!.name} moved` : `Category ${prev.name} updated`,
          changes: {
            ...(prev.name !== data.name ? { name: { from: prev.name, to: data.name } } : {}),
            ...(moved ? { parent_id: { from: prev.parentId, to: parentId } } : {}),
            ...(prev.sortOrder !== c!.sortOrder ? { sort_order: { from: prev.sortOrder, to: c!.sortOrder } } : {}),
          },
        });
      }
      return c!;
    });
  } catch (err) {
    mapErr(err, data.name);
  }
}
