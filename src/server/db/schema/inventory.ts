import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, tsz, updatedAt } from "./_shared";
import { user } from "./auth";
import { equipmentCase } from "./cases";
import { equipmentType, rentalHouse } from "./catalog";
import { document } from "./documents";
import { assignmentEndReason, equipmentCondition, equipmentStatus, trackingMode } from "./enums";
import { project } from "./workspace";

/**
 * A concrete physical object (or, for bulk tracking, N interchangeable units).
 * Items are never deleted: after a return they stay in the database with full history,
 * and are reused when the same serial turns up on a later delivery.
 *
 * Integrity is structural:
 *  - single project_id column      -> at most one active project
 *  - single case_id column         -> at most one case
 *  - FK (project_id, case_id)      -> the case belongs to the item's project
 *  - status/location check         -> returned items are off-project
 */
export const equipmentItem = pgTable(
  "equipment_item",
  {
    id: id(),
    workspaceId: uuid().notNull(),
    equipmentTypeId: uuid().notNull(),
    trackingMode: trackingMode().notNull().default("serialized"),
    quantity: integer().notNull().default(1),
    serialNumber: text(),
    assetNumber: text(),
    /** QR / barcode value (rental-house label or our own). */
    barcode: text(),
    /** Owner. NULL = owned by the production/crew rather than rented. */
    rentalHouseId: uuid(),
    projectId: uuid(),
    caseId: uuid(),
    status: equipmentStatus().notNull().default("available"),
    condition: equipmentCondition().notNull().default("unknown"),
    notes: text(),
    /** Set when a bulk item was split (e.g. partial return of 12 of 20). */
    splitFromItemId: uuid(),
    /** Optimistic-concurrency counter; incremented by the app on every update (also eases offline sync later). */
    version: integer().notNull().default(1),
    searchText: text().notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("equipment_item_workspace_id_uq").on(t.workspaceId, t.id),
    index().on(t.workspaceId, t.equipmentTypeId),
    index().on(t.projectId, t.status),
    index().on(t.caseId),
    index().on(t.rentalHouseId),
    index("equipment_item_search_trgm_idx").using("gin", t.searchText.op("gin_trgm_ops")),
    // Never silently merge physical items: a serial is unique per equipment type.
    uniqueIndex("equipment_item_serial_uq")
      .on(t.workspaceId, t.equipmentTypeId, sql`upper(${t.serialNumber})`)
      .where(sql`${t.serialNumber} IS NOT NULL`),
    uniqueIndex("equipment_item_asset_uq")
      .on(
        t.workspaceId,
        sql`coalesce(${t.rentalHouseId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`upper(${t.assetNumber})`,
      )
      .where(sql`${t.assetNumber} IS NOT NULL`),
    uniqueIndex("equipment_item_barcode_uq")
      .on(t.workspaceId, t.barcode)
      .where(sql`${t.barcode} IS NOT NULL`),
    check("equipment_item_quantity_ck", sql`${t.quantity} >= 1`),
    check(
      "equipment_item_serialized_qty_ck",
      sql`${t.trackingMode} = 'bulk' OR ${t.quantity} = 1`,
    ),
    check("equipment_item_case_needs_project_ck", sql`${t.caseId} IS NULL OR ${t.projectId} IS NOT NULL`),
    check(
      "equipment_item_status_location_ck",
      sql`(${t.status} IN ('available', 'returned') AND ${t.projectId} IS NULL)
        OR (${t.status} IN ('on_project', 'in_use', 'ready_for_return', 'missing') AND ${t.projectId} IS NOT NULL)`,
    ),
    check(
      "equipment_item_serial_not_blank_ck",
      sql`${t.serialNumber} IS NULL OR btrim(${t.serialNumber}) <> ''`,
    ),
    foreignKey({
      name: "equipment_item_type_fk",
      columns: [t.workspaceId, t.equipmentTypeId],
      foreignColumns: [equipmentType.workspaceId, equipmentType.id],
    }),
    foreignKey({
      name: "equipment_item_rental_house_fk",
      columns: [t.workspaceId, t.rentalHouseId],
      foreignColumns: [rentalHouse.workspaceId, rentalHouse.id],
    }),
    foreignKey({
      name: "equipment_item_project_fk",
      columns: [t.workspaceId, t.projectId],
      foreignColumns: [project.workspaceId, project.id],
    }),
    foreignKey({
      name: "equipment_item_case_fk",
      columns: [t.projectId, t.caseId],
      foreignColumns: [equipmentCase.projectId, equipmentCase.id],
    }),
    foreignKey({
      name: "equipment_item_split_from_fk",
      columns: [t.workspaceId, t.splitFromItemId],
      foreignColumns: [t.workspaceId, t.id],
    }),
  ],
);

/**
 * History of an item's project memberships (one row per stint on a project).
 * At most one open row per item (partial unique index); a deferred constraint trigger
 * keeps equipment_item.project_id consistent with the open row.
 */
export const projectAssignment = pgTable(
  "project_assignment",
  {
    id: id(),
    workspaceId: uuid().notNull(),
    equipmentItemId: uuid().notNull(),
    projectId: uuid().notNull(),
    /** Snapshot of the owner at assignment time. */
    rentalHouseId: uuid(),
    quantity: integer().notNull().default(1),
    deliveryDocumentId: uuid(),
    returnDocumentId: uuid(),
    assignedAt: tsz().notNull().defaultNow(),
    assignedById: uuid().references(() => user.id),
    endedAt: tsz(),
    endedById: uuid().references(() => user.id),
    endReason: assignmentEndReason(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("project_assignment_one_open_uq")
      .on(t.equipmentItemId)
      .where(sql`${t.endedAt} IS NULL`),
    index().on(t.projectId, t.endedAt),
    index().on(t.deliveryDocumentId),
    index().on(t.returnDocumentId),
    check("project_assignment_quantity_ck", sql`${t.quantity} >= 1`),
    check(
      "project_assignment_end_ck",
      sql`(${t.endedAt} IS NULL) = (${t.endReason} IS NULL) AND (${t.endedAt} IS NULL OR ${t.endedAt} >= ${t.assignedAt})`,
    ),
    foreignKey({
      name: "project_assignment_item_fk",
      columns: [t.workspaceId, t.equipmentItemId],
      foreignColumns: [equipmentItem.workspaceId, equipmentItem.id],
    }),
    foreignKey({
      name: "project_assignment_project_fk",
      columns: [t.workspaceId, t.projectId],
      foreignColumns: [project.workspaceId, project.id],
    }),
    foreignKey({
      name: "project_assignment_rental_house_fk",
      columns: [t.workspaceId, t.rentalHouseId],
      foreignColumns: [rentalHouse.workspaceId, rentalHouse.id],
    }),
    foreignKey({
      name: "project_assignment_delivery_doc_fk",
      columns: [t.workspaceId, t.deliveryDocumentId],
      foreignColumns: [document.workspaceId, document.id],
    }),
    foreignKey({
      name: "project_assignment_return_doc_fk",
      columns: [t.workspaceId, t.returnDocumentId],
      foreignColumns: [document.workspaceId, document.id],
    }),
  ],
);
