/**
 * Import of the standard equipment catalog into a workspace. Only adds what is
 * missing: an entry is skipped when the workspace already has a type with the
 * same manufacturer + model, or whose name / aliases already name it (spacing,
 * dashes and case ignored). Existing types and categories are never changed.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import { STANDARD_RENTAL_HOUSES, rentalHouseRegion, type StandardRentalHouse } from "../catalog/rental-houses";
import { STANDARD_CATALOG, STANDARD_CATALOG_VERSION, catalogSection, sectionEntries } from "../catalog/standard-catalog";
import { recordEvent } from "./audit";
import { DomainError, requireRole, type Ctx } from "./context";

const compact = (v: string) => v.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const entryName = (e: { manufacturer: string; model: string; name?: string }) => e.name ?? `${e.manufacturer} ${e.model}`;

/** Every spelling under which the workspace already knows a type. */
async function knownKeys(db: DbOrTx, ws: string) {
  const types = await db
    .select({ manufacturer: s.equipmentType.manufacturer, model: s.equipmentType.model, name: s.equipmentType.name, aliases: s.equipmentType.aliases })
    .from(s.equipmentType)
    .where(eq(s.equipmentType.workspaceId, ws)); // archived ones count too: never re-create what was archived
  const keys = new Set<string>();
  for (const t of types) {
    keys.add(compact(`${t.manufacturer} ${t.model}`));
    keys.add(compact(t.name));
    for (const a of t.aliases) if (compact(a).length >= 6) keys.add(compact(a)); // short aliases ("SP25") are too ambiguous
  }
  return keys;
}

/** Known under its current name, or under a name an earlier catalog version used for it. */
const isKnown = (keys: Set<string>, e: { manufacturer: string; model: string; name?: string; formerly?: string[] }) =>
  keys.has(compact(`${e.manufacturer} ${e.model}`)) || keys.has(compact(entryName(e))) || (e.formerly ?? []).some((f) => keys.has(compact(`${e.manufacturer} ${f}`)));

const CATALOG_MARK = "(standard catalog)";

/**
 * Types imported under a name a later catalog version corrected (wrong model name,
 * wrong T-stop) are renamed - but only when they came from the catalog and nobody
 * has edited them since. Anything a person touched stays exactly as it is.
 */
async function applyCorrections(tx: DbOrTx, ctx: Ctx, entries: ReturnType<typeof sectionEntries>, correlationId: string) {
  let corrected = 0;
  for (const e of entries.filter((x) => x.formerly?.length)) {
    for (const old of e.formerly!) {
      const [t] = await tx
        .select()
        .from(s.equipmentType)
        .where(and(eq(s.equipmentType.workspaceId, ctx.workspaceId), sql`lower(${s.equipmentType.manufacturer}) = lower(${e.manufacturer})`, sql`lower(${s.equipmentType.model}) = lower(${old})`));
      if (!t) continue;
      const history = await tx
        .select({ action: s.auditEvent.action, summary: s.auditEvent.summary })
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.workspaceId, ctx.workspaceId), eq(s.auditEvent.entityType, "equipment_type"), eq(s.auditEvent.entityId, t.id)));
      const fromCatalog = history.some((h) => h.action === "equipment_type.created" && h.summary.includes(CATALOG_MARK));
      const edited = history.some((h) => h.action === "equipment_type.updated");
      if (!fromCatalog || edited) continue;
      const [clash] = await tx
        .select({ id: s.equipmentType.id })
        .from(s.equipmentType)
        .where(and(eq(s.equipmentType.workspaceId, ctx.workspaceId), sql`lower(${s.equipmentType.manufacturer}) = lower(${e.manufacturer})`, sql`lower(${s.equipmentType.model}) = lower(${e.model})`));
      if (clash) continue;
      const name = entryName(e);
      await tx
        .update(s.equipmentType)
        .set({ model: e.model, name, aliases: [...new Set([...(e.aliases ?? []), ...t.aliases])], specs: { ...t.specs, ...(e.specs ?? {}) } })
        .where(eq(s.equipmentType.id, t.id));
      await recordEvent(tx, ctx, {
        action: "equipment_type.updated",
        entityType: "equipment_type",
        entityId: t.id,
        summary: `${t.name} corrected to ${name} ${CATALOG_MARK}`,
        changes: { model: { from: t.model, to: e.model }, name: { from: t.name, to: name } },
        correlationId,
      });
      corrected++;
    }
  }
  return corrected;
}

/** Sections with how many of their entries the workspace has already. */
export async function standardCatalogStatus(db: DbOrTx, ctx: Ctx) {
  const keys = await knownKeys(db, ctx.workspaceId);
  return STANDARD_CATALOG.map((section) => {
    const entries = sectionEntries(section);
    return { key: section.key, label: section.label, description: section.description, total: entries.length, present: entries.filter((e) => isKnown(keys, e)).length };
  });
}

export const importCatalogInput = z.object({
  sections: z.array(z.string()).min(1, "Choose at least one area to import."),
});

export async function importStandardCatalog(db: DbOrTx, ctx: Ctx, input: z.input<typeof importCatalogInput>) {
  requireRole(ctx, "admin");
  const { sections } = importCatalogInput.parse(input);
  const chosen = [...new Set(sections)].map((k) => {
    const section = catalogSection(k);
    if (!section) throw new DomainError("VALIDATION", `Unknown catalog area: ${k}`);
    return section;
  });
  const correlationId = randomUUID();

  return db.transaction(async (tx) => {
    // Serialize concurrent imports into the same workspace.
    await tx.select({ id: s.workspace.id }).from(s.workspace).where(eq(s.workspace.id, ctx.workspaceId)).for("update");
    const corrected = await applyCorrections(tx, ctx, chosen.flatMap(sectionEntries), correlationId);
    const keys = await knownKeys(tx, ctx.workspaceId);

    const categories = await tx.select().from(s.category).where(eq(s.category.workspaceId, ctx.workspaceId));
    const findCategory = (parentId: string | null, name: string) => categories.find((c) => c.parentId === parentId && c.name.toLowerCase() === name.toLowerCase());
    let categoriesCreated = 0;
    const ensureCategory = async (parentId: string | null, name: string) => {
      const found = findCategory(parentId, name);
      if (found) return found.id;
      const siblings = categories.filter((c) => c.parentId === parentId);
      const [c] = await tx
        .insert(s.category)
        .values({ workspaceId: ctx.workspaceId, parentId, name, sortOrder: siblings.reduce((m, x) => Math.max(m, x.sortOrder + 1), 0) })
        .returning();
      categories.push(c!);
      categoriesCreated++;
      await recordEvent(tx, ctx, { action: "category.created", entityType: "category", entityId: c!.id, summary: `Category ${name} created ${CATALOG_MARK}`, correlationId });
      return c!.id;
    };

    const rows: (typeof s.equipmentType.$inferInsert)[] = [];
    let skipped = 0;
    for (const section of chosen) {
      for (const group of section.groups) {
        const pending = group.entries.filter((e) => {
          if (isKnown(keys, e)) {
            skipped++;
            return false;
          }
          return true;
        });
        if (pending.length === 0) continue;
        const rootId = await ensureCategory(null, group.category[0]);
        const categoryId = await ensureCategory(rootId, group.category[1]);
        for (const e of pending) {
          keys.add(compact(`${e.manufacturer} ${e.model}`));
          keys.add(compact(entryName(e)));
          rows.push({
            workspaceId: ctx.workspaceId,
            categoryId,
            manufacturer: e.manufacturer,
            model: e.model,
            name: entryName(e),
            aliases: e.aliases ?? [],
            specs: e.specs ?? {},
            defaultTrackingMode: e.bulk ? "bulk" : "serialized",
          });
        }
      }
    }

    // Batches keep each statement well below the bind-parameter limit.
    const created: { id: string; name: string }[] = [];
    for (let i = 0; i < rows.length; i += 400) {
      created.push(...(await tx.insert(s.equipmentType).values(rows.slice(i, i + 400)).returning({ id: s.equipmentType.id, name: s.equipmentType.name })));
    }
    for (let i = 0; i < created.length; i += 400) {
      await tx.insert(s.auditEvent).values(
        created.slice(i, i + 400).map((t) => ({
          workspaceId: ctx.workspaceId,
          actorType: "user" as const,
          actorUserId: ctx.userId,
          action: "equipment_type.created" as const,
          entityType: "equipment_type",
          entityId: t.id,
          summary: `Equipment type ${t.name} created ${CATALOG_MARK}`,
          correlationId,
        })),
      );
    }
    await recordEvent(tx, ctx, {
      action: "catalog.imported",
      entityType: "workspace",
      entityId: ctx.workspaceId,
      summary: `Standard catalog imported (${chosen.map((c) => c.label).join(", ")}): ${created.length} equipment type${created.length === 1 ? "" : "s"} added, ${skipped} already present${corrected ? `, ${corrected} corrected` : ""}`,
      metadata: { version: STANDARD_CATALOG_VERSION, sections: chosen.map((c) => c.key), created: created.length, skipped, corrected, categoriesCreated },
      correlationId,
    });
    return { created: created.length, skipped, corrected, categoriesCreated };
  });
}

// ---------------------------------------------------------------------------
// Standard rental houses
// ---------------------------------------------------------------------------

/** Every spelling under which the workspace already knows a rental house (archived ones included). */
async function knownRentalHouseKeys(db: DbOrTx, ws: string) {
  const rows = await db
    .select({ name: s.rentalHouse.name, shortName: s.rentalHouse.shortName, aliases: s.rentalHouse.aliases })
    .from(s.rentalHouse)
    .where(eq(s.rentalHouse.workspaceId, ws));
  const keys = new Set<string>();
  for (const r of rows) for (const v of [r.name, r.shortName ?? "", ...r.aliases]) if (compact(v).length >= 3) keys.add(compact(v));
  return keys;
}

const houseKnown = (keys: Set<string>, h: StandardRentalHouse) => [h.name, ...(h.aliases ?? [])].some((v) => keys.has(compact(v)));

export async function standardRentalHouseStatus(db: DbOrTx, ctx: Ctx) {
  const keys = await knownRentalHouseKeys(db, ctx.workspaceId);
  return STANDARD_RENTAL_HOUSES.map((r) => ({ key: r.key, label: r.label, description: r.description, total: r.houses.length, present: r.houses.filter((h) => houseKnown(keys, h)).length }));
}

export const importRentalHousesInput = z.object({
  regions: z.array(z.string()).min(1, "Choose at least one region to import."),
});

export async function importStandardRentalHouses(db: DbOrTx, ctx: Ctx, input: z.input<typeof importRentalHousesInput>) {
  requireRole(ctx, "admin");
  const { regions } = importRentalHousesInput.parse(input);
  const chosen = [...new Set(regions)].map((k) => {
    const region = rentalHouseRegion(k);
    if (!region) throw new DomainError("VALIDATION", `Unknown region: ${k}`);
    return region;
  });
  const correlationId = randomUUID();
  return db.transaction(async (tx) => {
    await tx.select({ id: s.workspace.id }).from(s.workspace).where(eq(s.workspace.id, ctx.workspaceId)).for("update");
    const keys = await knownRentalHouseKeys(tx, ctx.workspaceId);
    let created = 0;
    let skipped = 0;
    for (const region of chosen) {
      for (const h of region.houses) {
        if (houseKnown(keys, h)) {
          skipped++;
          continue;
        }
        const [row] = await tx
          .insert(s.rentalHouse)
          .values({
            workspaceId: ctx.workspaceId,
            name: h.name,
            shortName: h.shortName ?? null,
            aliases: h.aliases ?? [],
            website: h.website ?? null,
            address: h.address ?? null,
            phone: h.phone ?? null,
            email: h.email ?? null,
            notes: h.notes ?? null,
          })
          .returning();
        for (const v of [h.name, ...(h.aliases ?? [])]) keys.add(compact(v));
        await recordEvent(tx, ctx, {
          action: "rental_house.created",
          entityType: "rental_house",
          entityId: row!.id,
          rentalHouseId: row!.id,
          summary: `Rental house ${h.name} created ${CATALOG_MARK}`,
          correlationId,
        });
        created++;
      }
    }
    await recordEvent(tx, ctx, {
      action: "catalog.imported",
      entityType: "workspace",
      entityId: ctx.workspaceId,
      summary: `Standard rental houses imported (${chosen.map((r) => r.label).join(", ")}): ${created} added, ${skipped} already present`,
      metadata: { kind: "rental_houses", regions: chosen.map((r) => r.key), created, skipped },
      correlationId,
    });
    return { created, skipped };
  });
}
