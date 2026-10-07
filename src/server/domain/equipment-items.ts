import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import { diff, recordEvent } from "./audit";
import { categoryWithDescendants } from "./categories";
import { splitBulkItem } from "./item-split";
import { DomainError, notFound, pgErrorOf, requireRole, type Ctx } from "./context";
import { optionalText, optionalUuid } from "./validation";

export const EQUIPMENT_STATUSES = s.equipmentStatus.enumValues;
export const EQUIPMENT_CONDITIONS = s.equipmentCondition.enumValues;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];
export type EquipmentCondition = (typeof EQUIPMENT_CONDITIONS)[number];

/** Statuses a user can set directly while the item is on a project. */
export const ON_PROJECT_STATUSES = ["on_project", "in_use", "ready_for_return", "missing"] as const satisfies readonly EquipmentStatus[];

export function itemLabel(i: { typeName: string; serialNumber?: string | null; trackingMode?: string; quantity?: number }) {
  if (i.serialNumber) return `${i.typeName} (SN ${i.serialNumber})`;
  if (i.trackingMode === "bulk" && (i.quantity ?? 1) > 1) return `${i.typeName} × ${i.quantity}`;
  return i.typeName;
}

const human = (v: string) => v.replaceAll("_", " ");

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const itemFilters = z.object({
  projectId: optionalUuid,
  categoryId: optionalUuid,
  rentalHouseId: z.preprocess((v) => (v === "" ? null : v), z.union([z.uuid(), z.literal("owned")]).nullable().optional()),
  status: z.preprocess((v) => (v === "" ? null : v), z.enum(EQUIPMENT_STATUSES).nullable().optional()),
  caseId: z.preprocess((v) => (v === "" ? null : v), z.union([z.uuid(), z.literal("none")]).nullable().optional()),
  equipmentTypeId: optionalUuid,
  location: z.preprocess((v) => (v === "" ? null : v), z.enum(["on_project", "off_project"]).nullable().optional()),
  q: optionalText(200),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ItemFilters = z.input<typeof itemFilters>;

export async function listItems(db: DbOrTx, ctx: Ctx, rawFilters: ItemFilters = {}) {
  const f = itemFilters.parse(rawFilters);
  const where: SQL[] = [eq(s.equipmentItem.workspaceId, ctx.workspaceId)];
  if (f.projectId) where.push(eq(s.equipmentItem.projectId, f.projectId));
  if (f.rentalHouseId === "owned") where.push(isNull(s.equipmentItem.rentalHouseId));
  else if (f.rentalHouseId) where.push(eq(s.equipmentItem.rentalHouseId, f.rentalHouseId));
  if (f.status) where.push(eq(s.equipmentItem.status, f.status));
  if (f.caseId === "none") where.push(isNull(s.equipmentItem.caseId));
  else if (f.caseId) where.push(eq(s.equipmentItem.caseId, f.caseId));
  if (f.equipmentTypeId) where.push(eq(s.equipmentItem.equipmentTypeId, f.equipmentTypeId));
  if (f.location === "on_project") where.push(isNotNull(s.equipmentItem.projectId));
  if (f.location === "off_project") where.push(isNull(s.equipmentItem.projectId));
  if (f.categoryId) {
    const ids = await categoryWithDescendants(db, ctx, f.categoryId);
    where.push(inArray(s.equipmentType.categoryId, ids.length ? ids : [f.categoryId]));
  }
  if (f.q) {
    // Match identifiers (serial / asset / barcode, also compacted) or the type's name/aliases.
    where.push(
      or(
        sql`${s.equipmentItem.searchText} LIKE '%' || search_normalize(${f.q}) || '%'`,
        sql`(search_compact(${f.q}) <> '' AND ${s.equipmentItem.searchText} LIKE '%' || search_compact(${f.q}) || '%')`,
        sql`${s.equipmentType.searchText} LIKE '%' || search_normalize(${f.q}) || '%'`,
        sql`${s.equipmentType.searchText} % search_normalize(${f.q})`,
        ilike(s.equipmentItem.notes, `%${f.q}%`),
      )!,
    );
  }
  return db
    .select({
      id: s.equipmentItem.id,
      serialNumber: s.equipmentItem.serialNumber,
      assetNumber: s.equipmentItem.assetNumber,
      barcode: s.equipmentItem.barcode,
      notes: s.equipmentItem.notes,
      trackingMode: s.equipmentItem.trackingMode,
      quantity: s.equipmentItem.quantity,
      status: s.equipmentItem.status,
      condition: s.equipmentItem.condition,
      typeId: s.equipmentType.id,
      typeName: s.equipmentType.name,
      manufacturer: s.equipmentType.manufacturer,
      categoryName: s.category.name,
      rentalHouseId: s.equipmentItem.rentalHouseId,
      rentalHouseName: s.rentalHouse.name,
      rentalHouseShort: s.rentalHouse.shortName,
      projectId: s.equipmentItem.projectId,
      projectName: s.project.name,
      caseId: s.equipmentItem.caseId,
      caseName: s.equipmentCase.name,
      updatedAt: s.equipmentItem.updatedAt,
      // The item's own photo, else the type's main reference image.
      imageId: sql<string | null>`coalesce(
        (SELECT p.id FROM photo p WHERE p.equipment_item_id = "equipment_item"."id" AND p.removed_at IS NULL ORDER BY p.created_at DESC LIMIT 1),
        (SELECT p.id FROM photo p WHERE p.equipment_type_id = "equipment_type"."id" AND p.kind = 'reference' AND p.removed_at IS NULL ORDER BY p.is_primary DESC, p.created_at DESC LIMIT 1))`,
    })
    .from(s.equipmentItem)
    .innerJoin(s.equipmentType, eq(s.equipmentType.id, s.equipmentItem.equipmentTypeId))
    .leftJoin(s.category, eq(s.category.id, s.equipmentType.categoryId))
    .leftJoin(s.rentalHouse, eq(s.rentalHouse.id, s.equipmentItem.rentalHouseId))
    .leftJoin(s.project, eq(s.project.id, s.equipmentItem.projectId))
    .leftJoin(s.equipmentCase, eq(s.equipmentCase.id, s.equipmentItem.caseId))
    .where(and(...where))
    .orderBy(
      // Group by top-level category, then subcategory (both in the user's chosen order).
      sql`coalesce((SELECT p.sort_order FROM category p WHERE p.id = ${s.category.parentId}), ${s.category.sortOrder}, 999)`,
      sql`${s.category.parentId} IS NOT NULL`,
      asc(s.category.sortOrder),
      asc(s.equipmentType.name),
      asc(s.equipmentItem.serialNumber),
    )
    .limit(f.limit);
}
export type ItemRow = Awaited<ReturnType<typeof listItems>>[number];

export async function getItemDetail(db: DbOrTx, ctx: Ctx, id: string) {
  const [row] = await db
    .select({
      item: s.equipmentItem,
      type: s.equipmentType,
      categoryName: s.category.name,
      rentalHouse: { id: s.rentalHouse.id, name: s.rentalHouse.name },
      project: { id: s.project.id, name: s.project.name, status: s.project.status },
      case: { id: s.equipmentCase.id, name: s.equipmentCase.name, code: s.equipmentCase.code },
    })
    .from(s.equipmentItem)
    .innerJoin(s.equipmentType, eq(s.equipmentType.id, s.equipmentItem.equipmentTypeId))
    .leftJoin(s.category, eq(s.category.id, s.equipmentType.categoryId))
    .leftJoin(s.rentalHouse, eq(s.rentalHouse.id, s.equipmentItem.rentalHouseId))
    .leftJoin(s.project, eq(s.project.id, s.equipmentItem.projectId))
    .leftJoin(s.equipmentCase, eq(s.equipmentCase.id, s.equipmentItem.caseId))
    .where(and(eq(s.equipmentItem.id, id), eq(s.equipmentItem.workspaceId, ctx.workspaceId)));
  if (!row) notFound("Equipment item");

  const [assignments, documents, issues, photos, timeline, referencePhoto, splitChildren] = await Promise.all([
    db.execute<{
      id: string;
      project_id: string;
      project_name: string;
      rental_house_name: string | null;
      quantity: number;
      assigned_at: Date;
      ended_at: Date | null;
      end_reason: string | null;
      delivery_document_id: string | null;
      delivery_number: string | null;
      return_document_id: string | null;
      return_number: string | null;
    }>(sql`
      SELECT a.id, a.project_id, p.name AS project_name, rh.name AS rental_house_name, a.quantity,
             a.assigned_at, a.ended_at, a.end_reason::text,
             a.delivery_document_id, dd.document_number AS delivery_number,
             a.return_document_id, rd.document_number AS return_number
      FROM project_assignment a
      JOIN project p ON p.id = a.project_id
      LEFT JOIN rental_house rh ON rh.id = a.rental_house_id
      LEFT JOIN document dd ON dd.id = a.delivery_document_id
      LEFT JOIN document rd ON rd.id = a.return_document_id
      WHERE a.equipment_item_id = ${id}
      ORDER BY a.assigned_at DESC`),
    db.execute<{ id: string; kind: string; status: string; document_number: string | null; document_date: string | null; project_name: string | null; rental_house_name: string | null }>(sql`
      SELECT d.id, d.kind::text, d.status::text, d.document_number, d.document_date::text, p.name AS project_name, rh.name AS rental_house_name
      FROM document d
      LEFT JOIN project p ON p.id = d.project_id
      LEFT JOIN rental_house rh ON rh.id = d.rental_house_id
      WHERE d.workspace_id = ${ctx.workspaceId} AND d.id IN (
        SELECT delivery_document_id FROM project_assignment WHERE equipment_item_id = ${id}
        UNION SELECT return_document_id FROM project_assignment WHERE equipment_item_id = ${id}
        UNION SELECT document_id FROM document_line WHERE matched_equipment_item_id = ${id}
      )
      ORDER BY d.document_date DESC NULLS LAST`),
    db
      .select()
      .from(s.issue)
      .where(and(eq(s.issue.equipmentItemId, id), eq(s.issue.workspaceId, ctx.workspaceId)))
      .orderBy(desc(s.issue.createdAt)),
    db
      .select()
      .from(s.photo)
      .where(and(eq(s.photo.equipmentItemId, id), eq(s.photo.workspaceId, ctx.workspaceId), isNull(s.photo.removedAt)))
      .orderBy(desc(s.photo.createdAt)),
    getItemTimeline(db, ctx, id),
    db
      .select()
      .from(s.photo)
      .where(and(eq(s.photo.equipmentTypeId, row.type.id), eq(s.photo.kind, "reference"), isNull(s.photo.removedAt)))
      .orderBy(desc(s.photo.isPrimary), desc(s.photo.createdAt))
      .limit(1),
    db
      .select({ id: s.equipmentItem.id, quantity: s.equipmentItem.quantity, status: s.equipmentItem.status })
      .from(s.equipmentItem)
      .where(and(eq(s.equipmentItem.splitFromItemId, id), eq(s.equipmentItem.workspaceId, ctx.workspaceId))),
  ]);

  // Without a serial, units are interchangeable: other entries of the same kind in the same place and state.
  const it = row.item;
  const sameUnits = it.serialNumber
    ? []
    : await db
        .select({ id: s.equipmentItem.id, quantity: s.equipmentItem.quantity })
        .from(s.equipmentItem)
        .where(
          and(
            eq(s.equipmentItem.workspaceId, ctx.workspaceId),
            eq(s.equipmentItem.equipmentTypeId, it.equipmentTypeId),
            ne(s.equipmentItem.id, it.id),
            isNull(s.equipmentItem.serialNumber),
            eq(s.equipmentItem.status, it.status),
            eq(s.equipmentItem.condition, it.condition),
            it.projectId ? eq(s.equipmentItem.projectId, it.projectId) : isNull(s.equipmentItem.projectId),
            it.caseId ? eq(s.equipmentItem.caseId, it.caseId) : isNull(s.equipmentItem.caseId),
            it.rentalHouseId ? eq(s.equipmentItem.rentalHouseId, it.rentalHouseId) : isNull(s.equipmentItem.rentalHouseId),
          ),
        )
        .orderBy(desc(s.equipmentItem.quantity))
        .limit(50);

  return {
    ...row,
    sameUnits,
    label: itemLabel({ typeName: row.type.name, ...row.item }),
    assignments: [...assignments],
    documents: [...documents],
    issues,
    photos,
    timeline,
    referencePhoto: referencePhoto[0] ?? null,
    splitChildren,
  };
}

export async function getItemTimeline(db: DbOrTx, ctx: Ctx, id: string) {
  return db
    .select({
      id: s.auditEvent.id,
      occurredAt: s.auditEvent.occurredAt,
      action: s.auditEvent.action,
      summary: s.auditEvent.summary,
      actorType: s.auditEvent.actorType,
      actorName: s.user.name,
      changes: s.auditEvent.changes,
      metadata: s.auditEvent.metadata,
      projectId: s.auditEvent.projectId,
      projectName: s.project.name,
      documentId: s.auditEvent.documentId,
      caseId: s.auditEvent.caseId,
      correlationId: s.auditEvent.correlationId,
    })
    .from(s.auditEvent)
    .leftJoin(s.user, eq(s.user.id, s.auditEvent.actorUserId))
    .leftJoin(s.project, eq(s.project.id, s.auditEvent.projectId))
    .where(and(eq(s.auditEvent.workspaceId, ctx.workspaceId), eq(s.auditEvent.equipmentItemId, id)))
    .orderBy(desc(s.auditEvent.occurredAt), desc(s.auditEvent.id));
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Lock the item row for the rest of the transaction and load what summaries need. */
export async function lockItem(tx: DbOrTx, ctx: Ctx, id: string) {
  const [row] = await tx
    .select({ item: s.equipmentItem, typeName: s.equipmentType.name })
    .from(s.equipmentItem)
    .innerJoin(s.equipmentType, eq(s.equipmentType.id, s.equipmentItem.equipmentTypeId))
    .where(and(eq(s.equipmentItem.id, id), eq(s.equipmentItem.workspaceId, ctx.workspaceId)))
    .for("update", { of: s.equipmentItem });
  if (!row) notFound("Equipment item");
  return { ...row.item, typeName: row.typeName, label: itemLabel({ typeName: row.typeName, ...row.item }) };
}

function checkVersion(current: number, expected: number | undefined) {
  if (expected !== undefined && expected !== current) {
    throw new DomainError("CONFLICT", "This item was changed by someone else in the meantime. Reload and try again.");
  }
}

async function getActiveProject(tx: DbOrTx, ctx: Ctx, projectId: string) {
  const [p] = await tx
    .select()
    .from(s.project)
    .where(and(eq(s.project.id, projectId), eq(s.project.workspaceId, ctx.workspaceId)));
  if (!p) notFound("Project");
  if (p.status === "closed" || p.archivedAt) {
    throw new DomainError("VALIDATION", `Project ${p.name} is closed; equipment cannot be added to it.`);
  }
  return p;
}

/** Make sure the project ↔ rental-house relationship exists (never closed by returns). */
export async function ensureProjectRentalHouse(tx: DbOrTx, ctx: Ctx, projectId: string, rentalHouseId: string | null) {
  if (!rentalHouseId) return;
  const inserted = await tx
    .insert(s.projectRentalHouse)
    .values({ workspaceId: ctx.workspaceId, projectId, rentalHouseId })
    .onConflictDoNothing()
    .returning({ id: s.projectRentalHouse.id });
  if (inserted.length > 0) {
    const [rh] = await tx.select({ name: s.rentalHouse.name }).from(s.rentalHouse).where(eq(s.rentalHouse.id, rentalHouseId));
    await recordEvent(tx, ctx, {
      action: "rental_house.linked_to_project",
      entityType: "rental_house",
      entityId: rentalHouseId,
      rentalHouseId,
      projectId,
      summary: `${rh?.name ?? "Rental house"} linked to project`,
    });
  }
}

async function identityConflict(tx: DbOrTx, ctx: Ctx, err: unknown, values: { equipmentTypeId: string; serialNumber?: string | null; assetNumber?: string | null; barcode?: string | null }): Promise<never> {
  const pg = pgErrorOf(err);
  if (pg?.code !== "23505") throw err;
  const field =
    pg.constraint_name === "equipment_item_serial_uq" ? "serial number" : pg.constraint_name === "equipment_item_asset_uq" ? "asset number" : "barcode";
  const value =
    field === "serial number" ? values.serialNumber : field === "asset number" ? values.assetNumber : values.barcode;
  const [existing] = await tx
    .select({ id: s.equipmentItem.id })
    .from(s.equipmentItem)
    .where(
      and(
        eq(s.equipmentItem.workspaceId, ctx.workspaceId),
        field === "serial number"
          ? and(eq(s.equipmentItem.equipmentTypeId, values.equipmentTypeId), sql`upper(${s.equipmentItem.serialNumber}) = upper(${value ?? ""})`)
          : field === "asset number"
            ? sql`upper(${s.equipmentItem.assetNumber}) = upper(${value ?? ""})`
            : eq(s.equipmentItem.barcode, value ?? ""),
      ),
    )
    .limit(1);
  throw new DomainError(
    "CONFLICT",
    `Another item already has ${field} “${value}”. Physical items are never merged automatically — open the existing item instead.`,
    { existingItemId: existing?.id, field },
  );
}

export const createItemInput = z.object({
  equipmentTypeId: z.uuid(),
  trackingMode: z.enum(["serialized", "bulk"]).optional(),
  quantity: z.coerce.number().int().min(1).max(100000).default(1),
  serialNumber: optionalText(100),
  assetNumber: optionalText(100),
  barcode: optionalText(200),
  rentalHouseId: optionalUuid,
  condition: z.enum(EQUIPMENT_CONDITIONS).default("ok"),
  notes: optionalText(4000),
  /** Put the new item straight onto a project. */
  projectId: optionalUuid,
});
export type CreateItemInput = z.input<typeof createItemInput>;

export async function createItem(db: DbOrTx, ctx: Ctx, input: CreateItemInput) {
  requireRole(ctx, "member");
  const data = createItemInput.parse(input);
  return db.transaction(async (tx) => {
    const [type] = await tx
      .select()
      .from(s.equipmentType)
      .where(and(eq(s.equipmentType.id, data.equipmentTypeId), eq(s.equipmentType.workspaceId, ctx.workspaceId)));
    if (!type) notFound("Equipment type");
    const trackingMode = data.trackingMode ?? type.defaultTrackingMode;
    if (trackingMode === "serialized" && data.quantity !== 1) {
      throw new DomainError("VALIDATION", "Serialized items always have quantity 1. Create one item per serial number.");
    }
    if (data.rentalHouseId) {
      const [rh] = await tx
        .select({ id: s.rentalHouse.id })
        .from(s.rentalHouse)
        .where(and(eq(s.rentalHouse.id, data.rentalHouseId), eq(s.rentalHouse.workspaceId, ctx.workspaceId)));
      if (!rh) notFound("Rental house");
    }
    const project = data.projectId ? await getActiveProject(tx, ctx, data.projectId) : null;

    let item: typeof s.equipmentItem.$inferSelect;
    try {
      // Savepoint so a unique violation can be reported with a friendly message.
      item = await tx.transaction(async (sp) => {
        const [row] = await sp
          .insert(s.equipmentItem)
          .values({
            workspaceId: ctx.workspaceId,
            equipmentTypeId: type.id,
            trackingMode,
            quantity: data.quantity,
            serialNumber: data.serialNumber ?? null,
            assetNumber: data.assetNumber ?? null,
            barcode: data.barcode ?? null,
            rentalHouseId: data.rentalHouseId ?? null,
            condition: data.condition,
            notes: data.notes ?? null,
            projectId: project?.id ?? null,
            status: project ? "on_project" : "available",
          })
          .returning();
        return row!;
      });
    } catch (err) {
      return identityConflict(tx, ctx, err, data);
    }
    const label = itemLabel({ typeName: type.name, ...item });
    await recordEvent(tx, ctx, {
      action: "equipment_item.created",
      entityType: "equipment_item",
      entityId: item.id,
      equipmentItemId: item.id,
      projectId: project?.id,
      rentalHouseId: item.rentalHouseId,
      summary: `${label} created`,
    });
    if (project) {
      await tx.insert(s.projectAssignment).values({
        workspaceId: ctx.workspaceId,
        equipmentItemId: item.id,
        projectId: project.id,
        rentalHouseId: item.rentalHouseId,
        quantity: item.quantity,
        assignedById: ctx.userId,
      });
      await ensureProjectRentalHouse(tx, ctx, project.id, item.rentalHouseId);
      await recordEvent(tx, ctx, {
        action: "equipment_item.assigned_to_project",
        entityType: "equipment_item",
        entityId: item.id,
        equipmentItemId: item.id,
        projectId: project.id,
        rentalHouseId: item.rentalHouseId,
        summary: `${label} added to ${project.name}`,
        changes: { status: { from: null, to: "on_project" }, project_id: { from: null, to: project.id } },
      });
    }
    return item;
  });
}

export const updateItemInput = z.object({
  serialNumber: optionalText(100),
  assetNumber: optionalText(100),
  barcode: optionalText(200),
  rentalHouseId: optionalUuid,
  notes: optionalText(4000),
  quantity: z.coerce.number().int().min(1).max(100000).optional(),
  expectedVersion: z.coerce.number().int().optional(),
});

/** Edit identifiers, owner, notes (and quantity for bulk items). */
export async function updateItem(db: DbOrTx, ctx: Ctx, id: string, input: z.input<typeof updateItemInput>) {
  requireRole(ctx, "member");
  const { expectedVersion, ...data } = updateItemInput.parse(input);
  return db.transaction(async (tx) => {
    const prev = await lockItem(tx, ctx, id);
    checkVersion(prev.version, expectedVersion);
    if (data.quantity !== undefined && prev.trackingMode === "serialized" && data.quantity !== 1) {
      throw new DomainError("VALIDATION", "Serialized items always have quantity 1.");
    }
    const values = {
      serialNumber: data.serialNumber ?? null,
      assetNumber: data.assetNumber ?? null,
      barcode: data.barcode ?? null,
      rentalHouseId: data.rentalHouseId ?? null,
      notes: data.notes ?? null,
      ...(data.quantity !== undefined ? { quantity: data.quantity } : {}),
    };
    const changes = diff(prev, values);
    if (Object.keys(changes).length === 0) return prev;
    try {
      await tx.transaction(async (sp) => {
        await sp
          .update(s.equipmentItem)
          .set({ ...values, version: sql`${s.equipmentItem.version} + 1` })
          .where(eq(s.equipmentItem.id, id));
      });
    } catch (err) {
      return identityConflict(tx, ctx, err, { equipmentTypeId: prev.equipmentTypeId, ...values });
    }
    if (prev.projectId && values.rentalHouseId) await ensureProjectRentalHouse(tx, ctx, prev.projectId, values.rentalHouseId);
    const fields = Object.keys(changes).map((k) => human(k.replace(/([A-Z])/g, "_$1").toLowerCase()));
    await recordEvent(tx, ctx, {
      action: "equipment_item.updated",
      entityType: "equipment_item",
      entityId: id,
      equipmentItemId: id,
      projectId: prev.projectId,
      caseId: prev.caseId,
      summary: `${prev.label}: ${fields.join(", ")} updated`,
      changes,
    });
    return { ...prev, ...values };
  });
}

/** The item itself, or - for a change to only some units of a bulk item - the units split off from it. */
async function someUnits(tx: DbOrTx, ctx: Ctx, item: Awaited<ReturnType<typeof lockItem>>, units: number | undefined, reason: string) {
  if (units === undefined || units >= item.quantity) return item;
  if (item.trackingMode !== "bulk") throw new DomainError("VALIDATION", `${item.label} is tracked individually.`);
  return splitBulkItem(tx, ctx, item, units, { reason });
}

export const changeStatusInput = z.object({
  status: z.enum(ON_PROJECT_STATUSES),
  note: optionalText(1000),
  /** Bulk items: apply to only this many units (the rest stays as it is). Empty = all. */
  units: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().min(1).optional()),
  expectedVersion: z.coerce.number().int().optional(),
});

/**
 * User-driven status change while on a project (in use, ready for return, missing …).
 * Moving on/off a project goes through assignToProject / removeFromProject / returns.
 */
export async function changeStatus(db: DbOrTx, ctx: Ctx, id: string, input: z.input<typeof changeStatusInput>) {
  requireRole(ctx, "member");
  const data = changeStatusInput.parse(input);
  return db.transaction(async (tx) => {
    const prev = await lockItem(tx, ctx, id);
    checkVersion(prev.version, data.expectedVersion);
    if (!prev.projectId) {
      throw new DomainError("VALIDATION", "Only equipment on a project can change status. Add it to a project first.");
    }
    if (prev.status === data.status) return prev;
    const target = await someUnits(tx, ctx, prev, data.units, `status ${human(data.status)}`);
    await tx
      .update(s.equipmentItem)
      .set({ status: data.status, version: sql`${s.equipmentItem.version} + 1` })
      .where(eq(s.equipmentItem.id, target.id));
    await recordEvent(tx, ctx, {
      action: "equipment_item.status_changed",
      entityType: "equipment_item",
      entityId: target.id,
      equipmentItemId: target.id,
      projectId: prev.projectId,
      caseId: prev.caseId,
      summary: `${target.label}: ${human(prev.status)} → ${human(data.status)}`,
      changes: { status: { from: prev.status, to: data.status } },
      metadata: data.note ? { note: data.note } : null,
    });
    return { ...target, status: data.status };
  });
}

export const changeConditionInput = z.object({
  condition: z.enum(EQUIPMENT_CONDITIONS),
  note: optionalText(1000),
  /** Bulk items: apply to only this many units (the rest stays as it is). Empty = all. */
  units: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().min(1).optional()),
  expectedVersion: z.coerce.number().int().optional(),
});

export async function changeCondition(db: DbOrTx, ctx: Ctx, id: string, input: z.input<typeof changeConditionInput>) {
  requireRole(ctx, "member");
  const data = changeConditionInput.parse(input);
  return db.transaction(async (tx) => {
    const prev = await lockItem(tx, ctx, id);
    checkVersion(prev.version, data.expectedVersion);
    if (prev.condition === data.condition) return prev;
    const target = await someUnits(tx, ctx, prev, data.units, `condition ${human(data.condition)}`);
    await tx
      .update(s.equipmentItem)
      .set({ condition: data.condition, version: sql`${s.equipmentItem.version} + 1` })
      .where(eq(s.equipmentItem.id, target.id));
    await recordEvent(tx, ctx, {
      action: "equipment_item.condition_changed",
      entityType: "equipment_item",
      entityId: target.id,
      equipmentItemId: target.id,
      projectId: prev.projectId,
      caseId: prev.caseId,
      summary: `${target.label}: condition ${human(prev.condition)} → ${human(data.condition)}`,
      changes: { condition: { from: prev.condition, to: data.condition } },
      metadata: data.note ? { note: data.note } : null,
    });
    return { ...target, condition: data.condition };
  });
}

export const assignInput = z.object({ projectId: z.uuid(), note: optionalText(1000) });

/** Put an off-project item onto a project. An item can never be on two projects at once. */
export async function assignToProject(db: DbOrTx, ctx: Ctx, id: string, input: z.input<typeof assignInput>) {
  requireRole(ctx, "member");
  const data = assignInput.parse(input);
  return db.transaction(async (tx) => {
    const prev = await lockItem(tx, ctx, id);
    if (prev.projectId === data.projectId) return prev;
    if (prev.projectId) {
      const [current] = await tx.select({ name: s.project.name }).from(s.project).where(eq(s.project.id, prev.projectId));
      throw new DomainError(
        "CONFLICT",
        `${prev.label} is still on ${current?.name ?? "another project"}. Return it or remove it from that project first.`,
      );
    }
    const project = await getActiveProject(tx, ctx, data.projectId);
    await tx
      .update(s.equipmentItem)
      .set({ projectId: project.id, status: "on_project", version: sql`${s.equipmentItem.version} + 1` })
      .where(eq(s.equipmentItem.id, id));
    await tx.insert(s.projectAssignment).values({
      workspaceId: ctx.workspaceId,
      equipmentItemId: id,
      projectId: project.id,
      rentalHouseId: prev.rentalHouseId,
      quantity: prev.quantity,
      assignedById: ctx.userId,
    });
    await ensureProjectRentalHouse(tx, ctx, project.id, prev.rentalHouseId);
    await recordEvent(tx, ctx, {
      action: "equipment_item.assigned_to_project",
      entityType: "equipment_item",
      entityId: id,
      equipmentItemId: id,
      projectId: project.id,
      rentalHouseId: prev.rentalHouseId,
      summary: `${prev.label} added to ${project.name}`,
      changes: { status: { from: prev.status, to: "on_project" }, project_id: { from: null, to: project.id } },
      metadata: data.note ? { note: data.note } : null,
    });
    return { ...prev, projectId: project.id, status: "on_project" as const };
  });
}

export const removeInput = z.object({ reason: z.string().trim().min(3, "Please give a short reason").max(1000) });

/**
 * Take an item off its project without a return note (e.g. added by mistake).
 * Real returns to a rental house go through the return-note workflow.
 */
export async function removeFromProject(db: DbOrTx, ctx: Ctx, id: string, input: z.input<typeof removeInput>) {
  requireRole(ctx, "member");
  const data = removeInput.parse(input);
  return db.transaction(async (tx) => {
    const prev = await lockItem(tx, ctx, id);
    if (!prev.projectId) throw new DomainError("VALIDATION", `${prev.label} is not on a project.`);
    const projectId = prev.projectId;
    await tx
      .update(s.equipmentItem)
      .set({ projectId: null, caseId: null, status: "available", version: sql`${s.equipmentItem.version} + 1` })
      .where(eq(s.equipmentItem.id, id));
    await tx
      .update(s.projectAssignment)
      .set({ endedAt: new Date(), endedById: ctx.userId, endReason: "removed" })
      .where(and(eq(s.projectAssignment.equipmentItemId, id), isNull(s.projectAssignment.endedAt)));
    if (prev.caseId) {
      await recordEvent(tx, ctx, {
        action: "equipment_item.removed_from_case",
        entityType: "equipment_item",
        entityId: id,
        equipmentItemId: id,
        caseId: prev.caseId,
        projectId,
        summary: `${prev.label} taken out of its set`,
        changes: { case_id: { from: prev.caseId, to: null } },
      });
    }
    await recordEvent(tx, ctx, {
      action: "equipment_item.removed_from_project",
      entityType: "equipment_item",
      entityId: id,
      equipmentItemId: id,
      projectId,
      summary: `${prev.label} removed from project`,
      changes: { status: { from: prev.status, to: "available" }, project_id: { from: projectId, to: null } },
      metadata: { reason: data.reason },
    });
    return { ...prev, projectId: null, caseId: null, status: "available" as const };
  });
}

/** Exact identifier lookup used by the QR/barcode scanner. */
export async function findItemByCode(db: DbOrTx, ctx: Ctx, code: string) {
  const c = code.trim();
  if (!c) return [];
  return db
    .select({ id: s.equipmentItem.id })
    .from(s.equipmentItem)
    .where(
      and(
        eq(s.equipmentItem.workspaceId, ctx.workspaceId),
        or(
          eq(s.equipmentItem.barcode, c),
          sql`upper(${s.equipmentItem.serialNumber}) = upper(${c})`,
          sql`upper(${s.equipmentItem.assetNumber}) = upper(${c})`,
        ),
      ),
    )
    .limit(5);
}
