import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tsz, updatedAt } from "./_shared";
import { user } from "./auth";
import { equipmentType, rentalHouse } from "./catalog";
import { document } from "./documents";
import { project, workspace } from "./workspace";

/**
 * Planned extra equipment for a few days ("2 × Sandsack, 14.–16.11."). Not
 * equipment yet: nothing is on the project until a delivery note brings it.
 * Confirming that delivery fulfils the need and gives the pieces its end date.
 */
export const plannedNeed = pgTable(
  "planned_need",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspace.id),
    projectId: uuid().notNull(),
    /** What is needed: a known type, or just a description. */
    equipmentTypeId: uuid(),
    label: text().notNull(),
    quantity: integer().notNull().default(1),
    rentalHouseId: uuid(),
    needFrom: date({ mode: "string" }).notNull(),
    needUntil: date({ mode: "string" }).notNull(),
    /** Remind to order / pick up on this day. */
    orderBy: date({ mode: "string" }),
    notes: text(),
    /** open → fulfilled (by a delivery) or cancelled. */
    status: text().$type<"open" | "fulfilled" | "cancelled">().notNull().default("open"),
    fulfilledDocumentId: uuid(),
    createdById: uuid().references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("planned_need_workspace_id_uq").on(t.workspaceId, t.id),
    index().on(t.projectId, t.status),
    check("planned_need_quantity_ck", sql`${t.quantity} >= 1`),
    check("planned_need_dates_ck", sql`${t.needUntil} >= ${t.needFrom}`),
    check("planned_need_status_ck", sql`${t.status} IN ('open', 'fulfilled', 'cancelled')`),
    foreignKey({ name: "planned_need_project_fk", columns: [t.workspaceId, t.projectId], foreignColumns: [project.workspaceId, project.id] }),
    foreignKey({ name: "planned_need_type_fk", columns: [t.workspaceId, t.equipmentTypeId], foreignColumns: [equipmentType.workspaceId, equipmentType.id] }),
    foreignKey({ name: "planned_need_rental_house_fk", columns: [t.workspaceId, t.rentalHouseId], foreignColumns: [rentalHouse.workspaceId, rentalHouse.id] }),
    foreignKey({ name: "planned_need_document_fk", columns: [t.workspaceId, t.fulfilledDocumentId], foreignColumns: [document.workspaceId, document.id] }),
  ],
);

/** One row per reminder sent, so several app containers or restarts never send it twice. */
export const reminderLog = pgTable(
  "reminder_log",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** e.g. "digest:2026-11-14" */
    key: text().notNull(),
    sentAt: tsz().notNull().defaultNow(),
    /** What was sent (for troubleshooting). */
    body: text(),
  },
  (t) => [unique("reminder_log_user_key_uq").on(t.userId, t.key)],
);
