import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import { recordEvent } from "./audit";
import { buildCategoryClosure, compareCase, type CaseComparison } from "./case-compare";
import { DomainError, notFound, pgErrorOf, requireRole, type Ctx } from "./context";
import { findItemByCode, itemLabel, lockItem } from "./equipment-items";
import { splitBulkItem } from "./item-split";
export { groupUnits } from "@/lib/group-units";
import { optionalText, optionalUuid, requiredText } from "./validation";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** "type:<uuid>" or "category:<uuid>" from a single select. */
const lineTarget = z
  .string()
  .regex(/^(type|category):[0-9a-f-]{36}$/i, "Choose an equipment type or category")
  .transform((v) => {
    const [kind, id] = v.split(":") as ["type" | "category", string];
    return kind === "type" ? { equipmentTypeId: id, categoryId: null } : { equipmentTypeId: null, categoryId: id };
  });

export const expectedLineInput = z.object({
  target: lineTarget,
  label: optionalText(120),
  quantity: z.coerce.number().int().min(1, "At least 1").max(999),
});

export const lineUpdateInput = z.object({
  label: requiredText(120),
  quantity: z.coerce.number().int().min(1, "At least 1").max(999),
});

/** Validate the target belongs to the workspace and produce a default label. */
async function resolveTarget(db: DbOrTx, ctx: Ctx, t: { equipmentTypeId: string | null; categoryId: string | null }) {
  if (t.equipmentTypeId) {
    const [row] = await db
      .select({ name: s.equipmentType.name })
      .from(s.equipmentType)
      .where(and(eq(s.equipmentType.id, t.equipmentTypeId), eq(s.equipmentType.workspaceId, ctx.workspaceId)));
    if (!row) notFound("Equipment type");
    return row.name;
  }
  const [row] = await db
    .select({ name: s.category.name })
    .from(s.category)
    .where(and(eq(s.category.id, t.categoryId!), eq(s.category.workspaceId, ctx.workspaceId)));
  if (!row) notFound("Category");
  return `Any ${row.name}`;
}

async function lockCase(tx: DbOrTx, ctx: Ctx, id: string) {
  const [c] = await tx
    .select()
    .from(s.equipmentCase)
    .where(and(eq(s.equipmentCase.id, id), eq(s.equipmentCase.workspaceId, ctx.workspaceId)))
    .for("update");
  if (!c) notFound("Set");
  return c;
}

function assertOpen(c: { archivedAt: Date | null; name: string }) {
  if (c.archivedAt) throw new DomainError("VALIDATION", `Set ${c.name} is archived.`);
}

function caseNameConflict(err: unknown, name: string): never {
  const pg = pgErrorOf(err);
  if (pg?.code === "23505" && pg.constraint_name === "equipment_case_name_uq") {
    throw new DomainError("CONFLICT", `This project already has a set named “${name}”.`);
  }
  if (pg?.code === "23505" && pg.constraint_name === "equipment_case_barcode_uq") {
    throw new DomainError("CONFLICT", "Another set already uses this barcode.");
  }
  if (pg?.code === "23505" && pg.constraint_name === "case_template_name_uq") {
    throw new DomainError("CONFLICT", `A template named “${name}” already exists.`);
  }
  throw err;
}

async function loadClosure(db: DbOrTx, ctx: Ctx) {
  const cats = await db
    .select({ id: s.category.id, parentId: s.category.parentId })
    .from(s.category)
    .where(eq(s.category.workspaceId, ctx.workspaceId));
  return buildCategoryClosure(cats);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface CaseSummary {
  id: string;
  name: string;
  code: string | null;
  projectId: string;
  projectName: string;
  templateName: string | null;
  comparison: CaseComparison;
}

/** Cases with their expected-vs-actual status (one round trip per table, compared in memory). */
export async function listCases(db: DbOrTx, ctx: Ctx, opts: { projectId?: string } = {}): Promise<CaseSummary[]> {
  const where = [eq(s.equipmentCase.workspaceId, ctx.workspaceId), isNull(s.equipmentCase.archivedAt)];
  if (opts.projectId) where.push(eq(s.equipmentCase.projectId, opts.projectId));
  const cases = await db
    .select({
      id: s.equipmentCase.id,
      name: s.equipmentCase.name,
      code: s.equipmentCase.code,
      projectId: s.equipmentCase.projectId,
      projectName: s.project.name,
      templateName: s.caseTemplate.name,
    })
    .from(s.equipmentCase)
    .innerJoin(s.project, eq(s.project.id, s.equipmentCase.projectId))
    .leftJoin(s.caseTemplate, eq(s.caseTemplate.id, s.equipmentCase.templateId))
    .where(and(...where))
    .orderBy(asc(s.project.name), asc(s.equipmentCase.name));
  if (cases.length === 0) return [];
  const ids = cases.map((c) => c.id);
  const [lines, items, closure] = await Promise.all([
    db.select().from(s.caseExpectedItem).where(inArray(s.caseExpectedItem.caseId, ids)),
    db
      .select({
        id: s.equipmentItem.id,
        caseId: s.equipmentItem.caseId,
        equipmentTypeId: s.equipmentItem.equipmentTypeId,
        categoryId: s.equipmentType.categoryId,
        quantity: s.equipmentItem.quantity,
      })
      .from(s.equipmentItem)
      .innerJoin(s.equipmentType, eq(s.equipmentType.id, s.equipmentItem.equipmentTypeId))
      .where(inArray(s.equipmentItem.caseId, ids)),
    loadClosure(db, ctx),
  ]);
  return cases.map((c) => ({
    ...c,
    comparison: compareCase(
      lines.filter((l) => l.caseId === c.id),
      items.filter((i) => i.caseId === c.id),
      closure,
    ),
  }));
}

export async function getCaseDetail(db: DbOrTx, ctx: Ctx, id: string) {
  const [row] = await db
    .select({
      case: s.equipmentCase,
      projectName: s.project.name,
      projectStatus: s.project.status,
      templateName: s.caseTemplate.name,
    })
    .from(s.equipmentCase)
    .innerJoin(s.project, eq(s.project.id, s.equipmentCase.projectId))
    .leftJoin(s.caseTemplate, eq(s.caseTemplate.id, s.equipmentCase.templateId))
    .where(and(eq(s.equipmentCase.id, id), eq(s.equipmentCase.workspaceId, ctx.workspaceId)));
  if (!row) notFound("Set");
  const [lines, items, closure] = await Promise.all([
    db
      .select({
        line: s.caseExpectedItem,
        typeName: s.equipmentType.name,
        categoryName: s.category.name,
      })
      .from(s.caseExpectedItem)
      .leftJoin(s.equipmentType, eq(s.equipmentType.id, s.caseExpectedItem.equipmentTypeId))
      .leftJoin(s.category, eq(s.category.id, s.caseExpectedItem.categoryId))
      .where(eq(s.caseExpectedItem.caseId, id))
      .orderBy(asc(s.caseExpectedItem.sortOrder), asc(s.caseExpectedItem.createdAt)),
    db
      .select({
        id: s.equipmentItem.id,
        equipmentTypeId: s.equipmentItem.equipmentTypeId,
        categoryId: s.equipmentType.categoryId,
        quantity: s.equipmentItem.quantity,
        trackingMode: s.equipmentItem.trackingMode,
        serialNumber: s.equipmentItem.serialNumber,
        assetNumber: s.equipmentItem.assetNumber,
        status: s.equipmentItem.status,
        condition: s.equipmentItem.condition,
        typeName: s.equipmentType.name,
        rentalHouseId: s.equipmentItem.rentalHouseId,
        rentalHouseName: s.rentalHouse.shortName,
        caseId: s.equipmentItem.caseId,
      })
      .from(s.equipmentItem)
      .innerJoin(s.equipmentType, eq(s.equipmentType.id, s.equipmentItem.equipmentTypeId))
      .leftJoin(s.rentalHouse, eq(s.rentalHouse.id, s.equipmentItem.rentalHouseId))
      .where(and(eq(s.equipmentItem.caseId, id), eq(s.equipmentItem.workspaceId, ctx.workspaceId)))
      .orderBy(asc(s.equipmentType.name), asc(s.equipmentItem.serialNumber)),
    loadClosure(db, ctx),
  ]);
  const comparison = compareCase(
    lines.map((l) => l.line),
    items,
    closure,
  );
  // Equipment types / categories (incl. subcategories) that would fill a gap — used to suggest items to pack.
  const neededTypeIds = new Set<string>();
  const neededCategoryIds = new Set<string>();
  for (const r of comparison.lines) {
    if (r.missing === 0) continue;
    if (r.line.equipmentTypeId) neededTypeIds.add(r.line.equipmentTypeId);
    else if (r.line.categoryId) for (const c of closure.get(r.line.categoryId) ?? [r.line.categoryId]) neededCategoryIds.add(c);
  }
  return {
    ...row,
    neededTypeIds,
    neededCategoryIds,
    lines: lines.map((l) => ({ ...l.line, typeName: l.typeName, categoryName: l.categoryName })),
    items: items.map((i) => ({ ...i, label: itemLabel(i) })),
    comparison,
  };
}

/** Items on the case's project that are not in this case (for the pack picker). */
export async function listPackCandidates(db: DbOrTx, ctx: Ctx, caseId: string, q?: string | null) {
  const [c] = await db
    .select({ projectId: s.equipmentCase.projectId })
    .from(s.equipmentCase)
    .where(and(eq(s.equipmentCase.id, caseId), eq(s.equipmentCase.workspaceId, ctx.workspaceId)));
  if (!c) notFound("Set");
  const query = q?.trim();
  return db
    .select({
      id: s.equipmentItem.id,
      equipmentTypeId: s.equipmentItem.equipmentTypeId,
      categoryId: s.equipmentType.categoryId,
      typeName: s.equipmentType.name,
      serialNumber: s.equipmentItem.serialNumber,
      assetNumber: s.equipmentItem.assetNumber,
      quantity: s.equipmentItem.quantity,
      trackingMode: s.equipmentItem.trackingMode,
      status: s.equipmentItem.status,
      condition: s.equipmentItem.condition,
      rentalHouseId: s.equipmentItem.rentalHouseId,
      caseId: s.equipmentItem.caseId,
      caseName: s.equipmentCase.name,
    })
    .from(s.equipmentItem)
    .innerJoin(s.equipmentType, eq(s.equipmentType.id, s.equipmentItem.equipmentTypeId))
    .leftJoin(s.equipmentCase, eq(s.equipmentCase.id, s.equipmentItem.caseId))
    .where(
      and(
        eq(s.equipmentItem.workspaceId, ctx.workspaceId),
        eq(s.equipmentItem.projectId, c.projectId),
        or(isNull(s.equipmentItem.caseId), ne(s.equipmentItem.caseId, caseId)),
        query
          ? or(
              sql`${s.equipmentItem.searchText} LIKE '%' || search_normalize(${query}) || '%'`,
              sql`(search_compact(${query}) <> '' AND ${s.equipmentItem.searchText} LIKE '%' || search_compact(${query}) || '%')`,
              sql`${s.equipmentType.searchText} LIKE '%' || search_normalize(${query}) || '%'`,
              sql`${s.equipmentType.searchText} % search_normalize(${query})`,
            )
          : undefined,
      ),
    )
    // Unpacked items first, then by name.
    .orderBy(sql`${s.equipmentItem.caseId} IS NOT NULL`, asc(s.equipmentType.name), asc(s.equipmentItem.serialNumber))
    .limit(200);
}

// ---------------------------------------------------------------------------
// Case mutations
// ---------------------------------------------------------------------------

export const caseInput = z.object({
  name: requiredText(80),
  code: optionalText(30),
  barcode: optionalText(200),
  description: optionalText(2000),
  notes: optionalText(4000),
});

export const createCaseInput = caseInput.extend({ projectId: z.uuid(), templateId: optionalUuid });

export async function createCase(db: DbOrTx, ctx: Ctx, input: z.input<typeof createCaseInput>) {
  requireRole(ctx, "member");
  const data = createCaseInput.parse(input);
  try {
    return await db.transaction(async (tx) => {
      const [project] = await tx
        .select()
        .from(s.project)
        .where(and(eq(s.project.id, data.projectId), eq(s.project.workspaceId, ctx.workspaceId)));
      if (!project) notFound("Project");
      if (project.status === "closed") throw new DomainError("VALIDATION", `Project ${project.name} is closed.`);
      let templateItems: (typeof s.caseTemplateItem.$inferSelect)[] = [];
      let templateName: string | null = null;
      if (data.templateId) {
        const [tpl] = await tx
          .select()
          .from(s.caseTemplate)
          .where(and(eq(s.caseTemplate.id, data.templateId), eq(s.caseTemplate.workspaceId, ctx.workspaceId), isNull(s.caseTemplate.archivedAt)));
        if (!tpl) notFound("Set template");
        templateName = tpl.name;
        templateItems = await tx.select().from(s.caseTemplateItem).where(eq(s.caseTemplateItem.templateId, tpl.id)).orderBy(asc(s.caseTemplateItem.sortOrder));
      }
      const [c] = await tx
        .insert(s.equipmentCase)
        .values({
          workspaceId: ctx.workspaceId,
          projectId: project.id,
          templateId: data.templateId ?? null,
          name: data.name,
          code: data.code ?? null,
          barcode: data.barcode ?? null,
          description: data.description ?? null,
          notes: data.notes ?? null,
        })
        .returning();
      if (templateItems.length) {
        await tx.insert(s.caseExpectedItem).values(
          templateItems.map((ti) => ({
            workspaceId: ctx.workspaceId,
            caseId: c!.id,
            equipmentTypeId: ti.equipmentTypeId,
            categoryId: ti.categoryId,
            label: ti.label,
            quantity: ti.quantity,
            sortOrder: ti.sortOrder,
          })),
        );
      }
      await recordEvent(tx, ctx, {
        action: "case.created",
        entityType: "case",
        entityId: c!.id,
        caseId: c!.id,
        projectId: project.id,
        summary: `Set ${c!.name} created${templateName ? ` from template “${templateName}”` : ""}`,
        metadata: templateName ? { templateId: data.templateId, expectedLines: templateItems.length } : null,
      });
      return c!;
    });
  } catch (err) {
    caseNameConflict(err, data.name);
  }
}

export async function updateCase(db: DbOrTx, ctx: Ctx, id: string, input: z.input<typeof caseInput>) {
  requireRole(ctx, "member");
  const data = caseInput.parse(input);
  const values = {
    name: data.name,
    code: data.code ?? null,
    barcode: data.barcode ?? null,
    description: data.description ?? null,
    notes: data.notes ?? null,
  };
  try {
    return await db.transaction(async (tx) => {
      const prev = await lockCase(tx, ctx, id);
      assertOpen(prev);
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const [k, v] of Object.entries(values)) {
        const before = prev[k as keyof typeof values];
        if ((before ?? null) !== v) changes[k] = { from: before ?? null, to: v };
      }
      if (Object.keys(changes).length === 0) return prev;
      const [c] = await tx.update(s.equipmentCase).set(values).where(eq(s.equipmentCase.id, id)).returning();
      await recordEvent(tx, ctx, {
        action: "case.updated",
        entityType: "case",
        entityId: id,
        caseId: id,
        projectId: prev.projectId,
        summary: `Set ${c!.name} updated`,
        changes,
      });
      return c!;
    });
  } catch (err) {
    caseNameConflict(err, data.name);
  }
}

/** Archive an empty case (history stays). Cases with equipment must be unpacked first. */
export async function archiveCase(db: DbOrTx, ctx: Ctx, id: string) {
  requireRole(ctx, "member");
  return db.transaction(async (tx) => {
    const c = await lockCase(tx, ctx, id);
    if (c.archivedAt) return c;
    const [{ n }] = (await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM equipment_item WHERE case_id = ${id}`)) as unknown as [{ n: number }];
    if (n > 0) throw new DomainError("VALIDATION", `Set ${c.name} still contains ${n} item${n === 1 ? "" : "s"}. Unpack them first.`);
    const [updated] = await tx.update(s.equipmentCase).set({ archivedAt: new Date() }).where(eq(s.equipmentCase.id, id)).returning();
    await recordEvent(tx, ctx, {
      action: "case.archived",
      entityType: "case",
      entityId: id,
      caseId: id,
      projectId: c.projectId,
      summary: `Set ${c.name} archived`,
    });
    return updated!;
  });
}

// ---------------------------------------------------------------------------
// Expected contents
// ---------------------------------------------------------------------------

export async function addExpectedLine(db: DbOrTx, ctx: Ctx, caseId: string, input: z.input<typeof expectedLineInput>) {
  requireRole(ctx, "member");
  const data = expectedLineInput.parse(input);
  return db.transaction(async (tx) => {
    const c = await lockCase(tx, ctx, caseId);
    assertOpen(c);
    const defaultLabel = await resolveTarget(tx, ctx, data.target);
    const [{ next }] = (await tx.execute<{ next: number }>(
      sql`SELECT coalesce(max(sort_order) + 1, 0)::int AS next FROM case_expected_item WHERE case_id = ${caseId}`,
    )) as unknown as [{ next: number }];
    const [line] = await tx
      .insert(s.caseExpectedItem)
      .values({ workspaceId: ctx.workspaceId, caseId, ...data.target, label: data.label ?? defaultLabel, quantity: data.quantity, sortOrder: next })
      .returning();
    await recordEvent(tx, ctx, {
      action: "case.expected_contents_changed",
      entityType: "case",
      entityId: caseId,
      caseId,
      projectId: c.projectId,
      summary: `${c.name}: expects ${line!.quantity} × ${line!.label}`,
      changes: { [`expected:${line!.label}`]: { from: 0, to: line!.quantity } },
    });
    return line!;
  });
}

async function lockLine(tx: DbOrTx, ctx: Ctx, lineId: string) {
  const [line] = await tx
    .select()
    .from(s.caseExpectedItem)
    .where(and(eq(s.caseExpectedItem.id, lineId), eq(s.caseExpectedItem.workspaceId, ctx.workspaceId)))
    .for("update");
  if (!line) notFound("Expected item");
  const c = await lockCase(tx, ctx, line.caseId);
  assertOpen(c);
  return { line, c };
}

export async function updateExpectedLine(db: DbOrTx, ctx: Ctx, lineId: string, input: z.input<typeof lineUpdateInput>) {
  requireRole(ctx, "member");
  const data = lineUpdateInput.parse(input);
  return db.transaction(async (tx) => {
    const { line, c } = await lockLine(tx, ctx, lineId);
    if (line.label === data.label && line.quantity === data.quantity) return line;
    const [updated] = await tx.update(s.caseExpectedItem).set(data).where(eq(s.caseExpectedItem.id, lineId)).returning();
    await recordEvent(tx, ctx, {
      action: "case.expected_contents_changed",
      entityType: "case",
      entityId: c.id,
      caseId: c.id,
      projectId: c.projectId,
      summary:
        line.quantity !== data.quantity
          ? `${c.name}: expected ${data.label} ${line.quantity} → ${data.quantity}`
          : `${c.name}: expected item renamed to ${data.label}`,
      changes: {
        ...(line.quantity !== data.quantity ? { [`expected:${data.label}`]: { from: line.quantity, to: data.quantity } } : {}),
        ...(line.label !== data.label ? { label: { from: line.label, to: data.label } } : {}),
      },
    });
    return updated!;
  });
}

export async function removeExpectedLine(db: DbOrTx, ctx: Ctx, lineId: string) {
  requireRole(ctx, "member");
  return db.transaction(async (tx) => {
    const { line, c } = await lockLine(tx, ctx, lineId);
    await tx.delete(s.caseExpectedItem).where(eq(s.caseExpectedItem.id, lineId));
    await recordEvent(tx, ctx, {
      action: "case.expected_contents_changed",
      entityType: "case",
      entityId: c.id,
      caseId: c.id,
      projectId: c.projectId,
      summary: `${c.name}: no longer expects ${line.label}`,
      changes: { [`expected:${line.label}`]: { from: line.quantity, to: 0 } },
    });
  });
}

// ---------------------------------------------------------------------------
// Packing
// ---------------------------------------------------------------------------

export const packOptions = z.object({ allowMove: z.coerce.boolean().default(false) });

/**
 * Put an item into a case. Items stay individually identifiable; a case only
 * records where they are. Moving out of another case must be explicit.
 */
export async function packItem(db: DbOrTx, ctx: Ctx, caseId: string, itemId: string, opts: { allowMove?: boolean } = {}) {
  requireRole(ctx, "member");
  return db.transaction(async (tx) => {
    const c = await lockCase(tx, ctx, caseId);
    assertOpen(c);
    const item = await lockItem(tx, ctx, itemId);
    if (item.caseId === caseId) return { item, moved: false, alreadyPacked: true };
    if (item.projectId !== c.projectId) {
      throw new DomainError(
        "VALIDATION",
        item.projectId ? `${item.label} is on another project and cannot go into this set.` : `${item.label} is not on this project. Add it to the project first.`,
        { itemId },
      );
    }
    let fromCase: { id: string; name: string } | null = null;
    if (item.caseId) {
      const [prev] = await tx.select({ id: s.equipmentCase.id, name: s.equipmentCase.name }).from(s.equipmentCase).where(eq(s.equipmentCase.id, item.caseId));
      fromCase = prev ?? null;
      if (!opts.allowMove) {
        throw new DomainError("CONFLICT", `${item.label} is packed in ${fromCase?.name ?? "another case"}. Move it here?`, {
          itemId,
          fromCaseId: item.caseId,
          fromCaseName: fromCase?.name,
          needsMoveConfirmation: true,
        });
      }
    }
    await tx
      .update(s.equipmentItem)
      .set({ caseId, version: sql`${s.equipmentItem.version} + 1` })
      .where(eq(s.equipmentItem.id, itemId));
    if (fromCase) {
      await recordEvent(tx, ctx, {
        action: "equipment_item.removed_from_case",
        entityType: "equipment_item",
        entityId: itemId,
        equipmentItemId: itemId,
        caseId: fromCase.id,
        projectId: c.projectId,
        summary: `${item.label} taken out of ${fromCase.name} (moved to ${c.name})`,
        changes: { case_id: { from: fromCase.id, to: caseId } },
      });
    }
    await recordEvent(tx, ctx, {
      action: "equipment_item.added_to_case",
      entityType: "equipment_item",
      entityId: itemId,
      equipmentItemId: itemId,
      caseId,
      projectId: c.projectId,
      summary: `${item.label} packed into ${c.name}`,
      changes: { case_id: { from: fromCase?.id ?? null, to: caseId } },
    });
    return { item: { ...item, caseId }, moved: Boolean(fromCase), alreadyPacked: false };
  });
}

/** Whole small items first, so taking N units splits as rarely as possible. */
async function smallestFirst(tx: DbOrTx, ctx: Ctx, itemIds: string[]) {
  if (itemIds.length === 0) return [];
  const rows = await tx
    .select({ id: s.equipmentItem.id })
    .from(s.equipmentItem)
    .where(and(inArray(s.equipmentItem.id, [...new Set(itemIds)]), eq(s.equipmentItem.workspaceId, ctx.workspaceId)))
    .orderBy(asc(s.equipmentItem.quantity), asc(s.equipmentItem.id));
  return rows.map((r) => r.id);
}

/**
 * Pack a number of interchangeable units (items without a serial number of one
 * type) in one go. Whole items are packed as they are; when only part of a bulk
 * item is needed it is split and the rest stays where it was.
 */
export async function packUnits(db: DbOrTx, ctx: Ctx, caseId: string, itemIds: string[], units: number, opts: { allowMove?: boolean } = {}) {
  requireRole(ctx, "member");
  if (!Number.isInteger(units) || units < 1) throw new DomainError("VALIDATION", "Choose how many to pack.");
  return db.transaction(async (tx) => {
    const c = await lockCase(tx, ctx, caseId);
    assertOpen(c);
    let left = units;
    let moved = false;
    let typeName = "";
    for (const id of await smallestFirst(tx, ctx, itemIds)) {
      if (left === 0) break;
      const item = await lockItem(tx, ctx, id);
      if (item.serialNumber) throw new DomainError("VALIDATION", `${item.label} has a serial number. Pack it on its own.`);
      if (item.caseId === caseId) continue;
      typeName = item.typeName;
      const part = item.quantity > left ? await splitBulkItem(tx, ctx, item, left, { reason: "packing", caseId: item.caseId }) : item;
      const r = await packItem(tx, ctx, caseId, part.id, opts);
      moved ||= r.moved;
      left -= part.quantity;
    }
    if (left === units) throw new DomainError("CONFLICT", "Nothing left to pack. Reload the page.");
    const packed = units - left;
    return { packed, moved, projectId: c.projectId, label: packed > 1 ? `${typeName} × ${packed}` : typeName, short: left };
  });
}

/** Take an item out of its case; for bulk items optionally only some units (the rest stays packed). */
export async function unpackItem(db: DbOrTx, ctx: Ctx, itemId: string, opts: { units?: number } = {}) {
  requireRole(ctx, "member");
  return db.transaction(async (tx) => {
    const locked = await lockItem(tx, ctx, itemId);
    if (!locked.caseId) return locked;
    const c = await lockCase(tx, ctx, locked.caseId);
    const item = opts.units !== undefined && opts.units < locked.quantity ? await splitBulkItem(tx, ctx, locked, opts.units, { reason: "taken out of set" }) : locked;
    itemId = item.id;
    await tx
      .update(s.equipmentItem)
      .set({ caseId: null, version: sql`${s.equipmentItem.version} + 1` })
      .where(eq(s.equipmentItem.id, itemId));
    await recordEvent(tx, ctx, {
      action: "equipment_item.removed_from_case",
      entityType: "equipment_item",
      entityId: itemId,
      equipmentItemId: itemId,
      caseId: c.id,
      projectId: c.projectId,
      summary: `${item.label} taken out of ${c.name}`,
      changes: { case_id: { from: c.id, to: null } },
    });
    return { ...item, caseId: null };
  });
}

/** Take a number of interchangeable units (items without serial of one type) out of a case. */
export async function unpackUnits(db: DbOrTx, ctx: Ctx, itemIds: string[], units: number) {
  requireRole(ctx, "member");
  if (!Number.isInteger(units) || units < 1) throw new DomainError("VALIDATION", "Choose how many to take out.");
  return db.transaction(async (tx) => {
    let left = units;
    let projectId: string | null = null;
    for (const id of await smallestFirst(tx, ctx, itemIds)) {
      if (left === 0) break;
      const item = await lockItem(tx, ctx, id);
      if (!item.caseId) continue;
      if (item.serialNumber) throw new DomainError("VALIDATION", `${item.label} has a serial number. Take it out on its own.`);
      projectId = item.projectId;
      const take = Math.min(left, item.quantity);
      await unpackItem(tx, ctx, item.id, { units: take });
      left -= take;
    }
    return { taken: units - left, projectId };
  });
}

/** Pack by scanned/typed code (barcode, serial or asset number). */
export async function packByCode(db: DbOrTx, ctx: Ctx, caseId: string, code: string, opts: { allowMove?: boolean } = {}) {
  requireRole(ctx, "member");
  const trimmed = code.trim();
  if (!trimmed) throw new DomainError("VALIDATION", "Scan or type a code first.");
  const matches = await findItemByCode(db, ctx, trimmed);
  if (matches.length === 0) throw new DomainError("NOT_FOUND", `No equipment with code “${trimmed}”.`, { code: trimmed });
  if (matches.length > 1) {
    // Prefer the one on this case's project; otherwise the code is ambiguous.
    const [c] = await db.select({ projectId: s.equipmentCase.projectId }).from(s.equipmentCase).where(eq(s.equipmentCase.id, caseId));
    const onProject = await db
      .select({ id: s.equipmentItem.id })
      .from(s.equipmentItem)
      .where(and(inArray(s.equipmentItem.id, matches.map((m) => m.id)), eq(s.equipmentItem.projectId, c?.projectId ?? "")));
    if (onProject.length !== 1) throw new DomainError("CONFLICT", `Code “${trimmed}” matches several items. Pick the item from the list instead.`, { code: trimmed });
    return packItem(db, ctx, caseId, onProject[0]!.id, opts);
  }
  return packItem(db, ctx, caseId, matches[0]!.id, opts);
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const templateInput = z.object({ name: requiredText(80), description: optionalText(2000) });

export async function listTemplates(db: DbOrTx, ctx: Ctx) {
  return db
    .select({
      id: s.caseTemplate.id,
      name: s.caseTemplate.name,
      description: s.caseTemplate.description,
      lineCount: sql<number>`(SELECT count(*)::int FROM case_template_item i WHERE i.template_id = "case_template"."id")`,
      unitCount: sql<number>`(SELECT coalesce(sum(quantity),0)::int FROM case_template_item i WHERE i.template_id = "case_template"."id")`,
      caseCount: sql<number>`(SELECT count(*)::int FROM equipment_case c WHERE c.template_id = "case_template"."id" AND c.archived_at IS NULL)`,
    })
    .from(s.caseTemplate)
    .where(and(eq(s.caseTemplate.workspaceId, ctx.workspaceId), isNull(s.caseTemplate.archivedAt)))
    .orderBy(asc(s.caseTemplate.name));
}

export async function getTemplate(db: DbOrTx, ctx: Ctx, id: string) {
  const [tpl] = await db
    .select()
    .from(s.caseTemplate)
    .where(and(eq(s.caseTemplate.id, id), eq(s.caseTemplate.workspaceId, ctx.workspaceId)));
  if (!tpl) notFound("Set template");
  const lines = await db
    .select({ line: s.caseTemplateItem, typeName: s.equipmentType.name, categoryName: s.category.name })
    .from(s.caseTemplateItem)
    .leftJoin(s.equipmentType, eq(s.equipmentType.id, s.caseTemplateItem.equipmentTypeId))
    .leftJoin(s.category, eq(s.category.id, s.caseTemplateItem.categoryId))
    .where(eq(s.caseTemplateItem.templateId, id))
    .orderBy(asc(s.caseTemplateItem.sortOrder), asc(s.caseTemplateItem.createdAt));
  return { ...tpl, lines: lines.map((l) => ({ ...l.line, typeName: l.typeName, categoryName: l.categoryName })) };
}

export async function createTemplate(db: DbOrTx, ctx: Ctx, input: z.input<typeof templateInput>) {
  requireRole(ctx, "member");
  const data = templateInput.parse(input);
  try {
    return await db.transaction(async (tx) => {
      const [tpl] = await tx.insert(s.caseTemplate).values({ workspaceId: ctx.workspaceId, ...data }).returning();
      await recordEvent(tx, ctx, {
        action: "case_template.created",
        entityType: "case_template",
        entityId: tpl!.id,
        summary: `Set template “${tpl!.name}” created`,
      });
      return tpl!;
    });
  } catch (err) {
    caseNameConflict(err, data.name);
  }
}

/** Save a case's current expected contents as a reusable template. */
export async function createTemplateFromCase(db: DbOrTx, ctx: Ctx, caseId: string, input: z.input<typeof templateInput>) {
  requireRole(ctx, "member");
  const data = templateInput.parse(input);
  try {
    return await db.transaction(async (tx) => {
      const c = await lockCase(tx, ctx, caseId);
      const lines = await tx.select().from(s.caseExpectedItem).where(eq(s.caseExpectedItem.caseId, caseId)).orderBy(asc(s.caseExpectedItem.sortOrder));
      if (lines.length === 0) throw new DomainError("VALIDATION", "This set has no expected contents to save.");
      const [tpl] = await tx.insert(s.caseTemplate).values({ workspaceId: ctx.workspaceId, ...data }).returning();
      await tx.insert(s.caseTemplateItem).values(
        lines.map((l) => ({
          workspaceId: ctx.workspaceId,
          templateId: tpl!.id,
          equipmentTypeId: l.equipmentTypeId,
          categoryId: l.categoryId,
          label: l.label,
          quantity: l.quantity,
          sortOrder: l.sortOrder,
        })),
      );
      await recordEvent(tx, ctx, {
        action: "case_template.created",
        entityType: "case_template",
        entityId: tpl!.id,
        caseId,
        projectId: c.projectId,
        summary: `Set template “${tpl!.name}” saved from set ${c.name}`,
      });
      return tpl!;
    });
  } catch (err) {
    caseNameConflict(err, data.name);
  }
}

async function lockTemplate(tx: DbOrTx, ctx: Ctx, id: string) {
  const [tpl] = await tx
    .select()
    .from(s.caseTemplate)
    .where(and(eq(s.caseTemplate.id, id), eq(s.caseTemplate.workspaceId, ctx.workspaceId)))
    .for("update");
  if (!tpl) notFound("Set template");
  if (tpl.archivedAt) throw new DomainError("VALIDATION", "This template is archived.");
  return tpl;
}

export async function updateTemplate(db: DbOrTx, ctx: Ctx, id: string, input: z.input<typeof templateInput>) {
  requireRole(ctx, "member");
  const data = templateInput.parse(input);
  try {
    return await db.transaction(async (tx) => {
      const prev = await lockTemplate(tx, ctx, id);
      const [tpl] = await tx.update(s.caseTemplate).set({ name: data.name, description: data.description ?? null }).where(eq(s.caseTemplate.id, id)).returning();
      if (prev.name !== tpl!.name || prev.description !== tpl!.description) {
        await recordEvent(tx, ctx, {
          action: "case_template.updated",
          entityType: "case_template",
          entityId: id,
          summary: `Set template “${tpl!.name}” updated`,
          changes: prev.name !== tpl!.name ? { name: { from: prev.name, to: tpl!.name } } : null,
        });
      }
      return tpl!;
    });
  } catch (err) {
    caseNameConflict(err, data.name);
  }
}

export async function archiveTemplate(db: DbOrTx, ctx: Ctx, id: string) {
  requireRole(ctx, "member");
  return db.transaction(async (tx) => {
    const tpl = await lockTemplate(tx, ctx, id);
    await tx.update(s.caseTemplate).set({ archivedAt: new Date() }).where(eq(s.caseTemplate.id, id));
    await recordEvent(tx, ctx, {
      action: "case_template.archived",
      entityType: "case_template",
      entityId: id,
      summary: `Set template “${tpl.name}” archived (existing sets keep their contents)`,
    });
  });
}

export async function addTemplateLine(db: DbOrTx, ctx: Ctx, templateId: string, input: z.input<typeof expectedLineInput>) {
  requireRole(ctx, "member");
  const data = expectedLineInput.parse(input);
  return db.transaction(async (tx) => {
    const tpl = await lockTemplate(tx, ctx, templateId);
    const defaultLabel = await resolveTarget(tx, ctx, data.target);
    const [{ next }] = (await tx.execute<{ next: number }>(
      sql`SELECT coalesce(max(sort_order) + 1, 0)::int AS next FROM case_template_item WHERE template_id = ${templateId}`,
    )) as unknown as [{ next: number }];
    const [line] = await tx
      .insert(s.caseTemplateItem)
      .values({ workspaceId: ctx.workspaceId, templateId, ...data.target, label: data.label ?? defaultLabel, quantity: data.quantity, sortOrder: next })
      .returning();
    await recordEvent(tx, ctx, {
      action: "case_template.updated",
      entityType: "case_template",
      entityId: templateId,
      summary: `Template “${tpl.name}”: ${line!.quantity} × ${line!.label} added`,
    });
    return line!;
  });
}

export async function updateTemplateLine(db: DbOrTx, ctx: Ctx, lineId: string, input: z.input<typeof lineUpdateInput>) {
  requireRole(ctx, "member");
  const data = lineUpdateInput.parse(input);
  return db.transaction(async (tx) => {
    const [line] = await tx
      .select()
      .from(s.caseTemplateItem)
      .where(and(eq(s.caseTemplateItem.id, lineId), eq(s.caseTemplateItem.workspaceId, ctx.workspaceId)));
    if (!line) notFound("Template line");
    const tpl = await lockTemplate(tx, ctx, line.templateId);
    await tx.update(s.caseTemplateItem).set(data).where(eq(s.caseTemplateItem.id, lineId));
    await recordEvent(tx, ctx, {
      action: "case_template.updated",
      entityType: "case_template",
      entityId: tpl.id,
      summary: `Template “${tpl.name}”: ${data.label} ${line.quantity} → ${data.quantity}`,
    });
  });
}

export async function removeTemplateLine(db: DbOrTx, ctx: Ctx, lineId: string) {
  requireRole(ctx, "member");
  return db.transaction(async (tx) => {
    const [line] = await tx
      .select()
      .from(s.caseTemplateItem)
      .where(and(eq(s.caseTemplateItem.id, lineId), eq(s.caseTemplateItem.workspaceId, ctx.workspaceId)));
    if (!line) notFound("Template line");
    const tpl = await lockTemplate(tx, ctx, line.templateId);
    await tx.delete(s.caseTemplateItem).where(eq(s.caseTemplateItem.id, lineId));
    await recordEvent(tx, ctx, {
      action: "case_template.updated",
      entityType: "case_template",
      entityId: tpl.id,
      summary: `Template “${tpl.name}”: ${line.label} removed`,
    });
  });
}

/** Options for "what should this line expect?" selects: types and categories. */
export async function listLineTargets(db: DbOrTx, ctx: Ctx) {
  // Equipment types are searched on demand (TypePicker); categories are few enough to list.
  const cats = await db
    .select({ id: s.category.id, name: s.category.name })
    .from(s.category)
    .where(eq(s.category.workspaceId, ctx.workspaceId))
    .orderBy(asc(s.category.name));
  return { categories: cats.map((c) => ({ value: `category:${c.id}`, label: `Any ${c.name}` })) };
}
