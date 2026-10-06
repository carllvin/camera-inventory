import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import { diff, recordEvent } from "./audit";
import { categoryWithDescendants } from "./categories";
import { DomainError, notFound, pgErrorOf, requireRole, type Ctx } from "./context";
import { optionalText, optionalUuid, requiredText, stringList } from "./validation";

/** Specs are edited as "key: value" lines. */
const specsText = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const out: Record<string, string> = {};
  for (const line of v.split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}, z.record(z.string().max(80), z.unknown()).default({}));

export const equipmentTypeInput = z.object({
  manufacturer: requiredText(80),
  model: requiredText(120),
  name: optionalText(200),
  categoryId: optionalUuid,
  aliases: stringList,
  description: optionalText(4000),
  specs: specsText,
  defaultTrackingMode: z.enum(["serialized", "bulk"]).default("serialized"),
});
export type EquipmentTypeInput = z.input<typeof equipmentTypeInput>;

export async function listEquipmentTypes(
  db: DbOrTx,
  ctx: Ctx,
  opts: { categoryId?: string | null; q?: string | null; inUse?: boolean; limit?: number; offset?: number } = {},
) {
  const where = [eq(s.equipmentType.workspaceId, ctx.workspaceId), isNull(s.equipmentType.archivedAt)];
  if (opts.categoryId) {
    const ids = await categoryWithDescendants(db, ctx, opts.categoryId);
    where.push(inArray(s.equipmentType.categoryId, ids.length ? ids : [opts.categoryId]));
  }
  const q = opts.q?.trim();
  if (q) {
    where.push(sql`(${s.equipmentType.searchText} LIKE '%' || search_normalize(${q}) || '%' OR ${s.equipmentType.searchText} % search_normalize(${q}))`);
  }
  const hasItems = sql`EXISTS (SELECT 1 FROM equipment_item i WHERE i.equipment_type_id = "equipment_type"."id")`;
  if (opts.inUse) where.push(hasItems);
  return db
    .select({
      id: s.equipmentType.id,
      name: s.equipmentType.name,
      manufacturer: s.equipmentType.manufacturer,
      model: s.equipmentType.model,
      aliases: s.equipmentType.aliases,
      defaultTrackingMode: s.equipmentType.defaultTrackingMode,
      categoryId: s.equipmentType.categoryId,
      categoryName: s.category.name,
      itemCount: sql<number>`(SELECT count(*)::int FROM equipment_item i WHERE i.equipment_type_id = "equipment_type"."id")`,
      onProjectCount: sql<number>`(SELECT count(*)::int FROM equipment_item i WHERE i.equipment_type_id = "equipment_type"."id" AND i.project_id IS NOT NULL)`,
      imageId: sql<string | null>`(SELECT p.id FROM photo p WHERE p.equipment_type_id = "equipment_type"."id" AND p.kind = 'reference' AND p.removed_at IS NULL ORDER BY p.is_primary DESC, p.created_at DESC LIMIT 1)`,
    })
    .from(s.equipmentType)
    .leftJoin(s.category, eq(s.category.id, s.equipmentType.categoryId))
    .where(and(...where))
    // Types with items first: with a large standard catalog, the ones in use matter most.
    .orderBy(desc(hasItems), asc(s.equipmentType.manufacturer), asc(s.equipmentType.model))
    .limit(opts.limit ?? 100000)
    .offset(opts.offset ?? 0);
}

export async function getEquipmentType(db: DbOrTx, ctx: Ctx, id: string) {
  const [row] = await db
    .select({ type: s.equipmentType, categoryName: s.category.name })
    .from(s.equipmentType)
    .leftJoin(s.category, eq(s.category.id, s.equipmentType.categoryId))
    .where(and(eq(s.equipmentType.id, id), eq(s.equipmentType.workspaceId, ctx.workspaceId)));
  if (!row) notFound("Equipment type");
  const photos = await db
    .select()
    .from(s.photo)
    .where(and(eq(s.photo.equipmentTypeId, id), eq(s.photo.kind, "reference"), isNull(s.photo.removedAt)))
    .orderBy(desc(s.photo.isPrimary), desc(s.photo.createdAt));
  return { ...row.type, categoryName: row.categoryName, photos };
}

function mapErr(err: unknown, input: { manufacturer: string; model: string }): never {
  const pg = pgErrorOf(err);
  if (pg?.code === "23505") {
    throw new DomainError("CONFLICT", `${input.manufacturer} ${input.model} already exists in the equipment database.`);
  }
  if (pg?.code === "23503") throw new DomainError("VALIDATION", "Category not found.");
  throw err;
}

export async function createEquipmentType(db: DbOrTx, ctx: Ctx, input: EquipmentTypeInput) {
  requireRole(ctx, "member");
  const data = equipmentTypeInput.parse(input);
  const name = data.name ?? `${data.manufacturer} ${data.model}`;
  try {
    return await db.transaction(async (tx) => {
      const [t] = await tx
        .insert(s.equipmentType)
        .values({ workspaceId: ctx.workspaceId, ...data, name, categoryId: data.categoryId ?? null })
        .returning();
      await recordEvent(tx, ctx, {
        action: "equipment_type.created",
        entityType: "equipment_type",
        entityId: t!.id,
        summary: `Equipment type ${name} created`,
      });
      return t!;
    });
  } catch (err) {
    mapErr(err, data);
  }
}

export async function updateEquipmentType(db: DbOrTx, ctx: Ctx, id: string, input: EquipmentTypeInput) {
  requireRole(ctx, "member");
  const data = equipmentTypeInput.parse(input);
  const values = { ...data, name: data.name ?? `${data.manufacturer} ${data.model}`, categoryId: data.categoryId ?? null };
  try {
    return await db.transaction(async (tx) => {
      const [prev] = await tx
        .select()
        .from(s.equipmentType)
        .where(and(eq(s.equipmentType.id, id), eq(s.equipmentType.workspaceId, ctx.workspaceId)))
        .for("update");
      if (!prev) notFound("Equipment type");
      const changes = diff(prev, values);
      if (Object.keys(changes).length === 0) return prev;
      const [t] = await tx.update(s.equipmentType).set(values).where(eq(s.equipmentType.id, id)).returning();
      await recordEvent(tx, ctx, {
        action: "equipment_type.updated",
        entityType: "equipment_type",
        entityId: id,
        summary: `Equipment type ${t!.name} updated`,
        changes,
      });
      return t!;
    });
  } catch (err) {
    mapErr(err, data);
  }
}

export async function listEquipmentTypeOptions(db: DbOrTx, ctx: Ctx) {
  return db
    .select({ id: s.equipmentType.id, name: s.equipmentType.name, defaultTrackingMode: s.equipmentType.defaultTrackingMode })
    .from(s.equipmentType)
    .where(and(eq(s.equipmentType.workspaceId, ctx.workspaceId), isNull(s.equipmentType.archivedAt)))
    .orderBy(asc(s.equipmentType.name));
}

/**
 * Type picker search: every word must appear (accents, case and "-"/spaces ignored),
 * or the text is similar enough (typos). Exact name / alias hits rank first, then
 * types that are actually in use. Without a query: the most used types.
 */
export async function searchEquipmentTypes(db: DbOrTx, ctx: Ctx, q: string | null | undefined, limit = 20) {
  const query = (q ?? "").trim().slice(0, 100);
  const words = query.split(/\s+/).filter(Boolean).slice(0, 6);
  const used = sql`(SELECT count(*) FROM equipment_item i WHERE i.equipment_type_id = t.id)`;
  if (words.length === 0) {
    return db.execute<{ id: string; name: string; category: string | null; tracking: "serialized" | "bulk" }>(sql`
      SELECT t.id, t.name, c.name AS category, t.default_tracking_mode AS tracking
      FROM equipment_type t LEFT JOIN category c ON c.id = t.category_id
      WHERE t.workspace_id = ${ctx.workspaceId} AND t.archived_at IS NULL
      ORDER BY ${used} DESC, t.name
      LIMIT ${limit}`);
  }
  const allWords = sql.join(
    words.map((w) => sql`(t.search_text LIKE '%' || search_normalize(${w}) || '%' OR search_compact(t.search_text) LIKE '%' || search_compact(${w}) || '%')`),
    sql` AND `,
  );
  return db.execute<{ id: string; name: string; category: string | null; tracking: "serialized" | "bulk" }>(sql`
    SELECT t.id, t.name, c.name AS category, t.default_tracking_mode AS tracking
    FROM equipment_type t LEFT JOIN category c ON c.id = t.category_id
    WHERE t.workspace_id = ${ctx.workspaceId} AND t.archived_at IS NULL
      AND ((${allWords}) OR word_similarity(search_normalize(${query}), t.search_text) >= 0.45)
    ORDER BY
      (search_compact(t.name) = search_compact(${query})
        OR search_compact(t.model) = search_compact(${query})
        OR EXISTS (SELECT 1 FROM unnest(t.aliases) a WHERE search_compact(a) = search_compact(${query}))) DESC,
      (${allWords}) DESC,
      (${used} > 0) DESC,
      word_similarity(search_normalize(${query}), t.search_text) DESC,
      t.name
    LIMIT ${limit}`);
}
