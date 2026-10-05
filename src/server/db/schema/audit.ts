import { sql } from "drizzle-orm";
import { bigserial, check, foreignKey, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { tsz } from "./_shared";
import { user } from "./auth";
import { equipmentCase } from "./cases";
import { rentalHouse } from "./catalog";
import { document } from "./documents";
import { actorType } from "./enums";
import { equipmentItem } from "./inventory";
import { issue } from "./issues";
import { project, workspace } from "./workspace";

/**
 * Known audit actions. Stored as text (not a pg enum) so new actions do not require
 * a migration; the app layer only writes values from this list.
 */
export const AUDIT_ACTIONS = [
  "project.created",
  "project.updated",
  "project.status_changed",
  "rental_house.created",
  "rental_house.updated",
  "rental_house.linked_to_project",
  "category.created",
  "category.updated",
  "category.moved",
  "equipment_type.created",
  "equipment_type.updated",
  "equipment_item.created",
  "equipment_item.updated",
  "equipment_item.assigned_to_project",
  "equipment_item.removed_from_project",
  "equipment_item.added_to_case",
  "equipment_item.removed_from_case",
  "equipment_item.status_changed",
  "equipment_item.condition_changed",
  "equipment_item.split",
  "equipment_item.returned",
  "case.created",
  "case.updated",
  "case.archived",
  "case.expected_contents_changed",
  "case_template.created",
  "case_template.updated",
  "case_template.archived",
  "document.uploaded",
  "document.extracted",
  "document.confirmed",
  "document.discarded",
  "delivery.imported",
  "return_note.imported",
  "return_check.performed",
  "photo.added",
  "photo.removed",
  "issue.created",
  "issue.updated",
  "issue.resolved",
  "issue.dismissed",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditChanges = Record<string, { from: unknown; to: unknown }>;

/**
 * Immutable history. UPDATE / DELETE / TRUNCATE are rejected by a trigger.
 * Subject columns (project, item, case, document, issue) are denormalized so that
 * every timeline is a single indexed query.
 */
export const auditEvent = pgTable(
  "audit_event",
  {
    /** Monotonic id gives a stable total order for events with identical timestamps. */
    id: bigserial({ mode: "number" }).primaryKey(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspace.id),
    occurredAt: tsz().notNull().defaultNow(),
    actorType: actorType().notNull().default("user"),
    actorUserId: uuid().references(() => user.id),
    action: text().$type<AuditAction>().notNull(),
    entityType: text().notNull(),
    entityId: uuid().notNull(),
    projectId: uuid(),
    equipmentItemId: uuid(),
    caseId: uuid(),
    documentId: uuid(),
    issueId: uuid(),
    rentalHouseId: uuid(),
    /** Human-readable one-liner, rendered in timelines. */
    summary: text().notNull(),
    changes: jsonb().$type<AuditChanges>(),
    metadata: jsonb().$type<Record<string, unknown>>(),
    /** Groups the events produced by one operation (e.g. one delivery confirmation). */
    correlationId: uuid(),
  },
  (t) => [
    index().on(t.workspaceId, t.occurredAt.desc()),
    index().on(t.equipmentItemId, t.occurredAt),
    index().on(t.projectId, t.occurredAt),
    index().on(t.caseId, t.occurredAt),
    index().on(t.documentId),
    index().on(t.issueId),
    index().on(t.entityType, t.entityId),
    index().on(t.correlationId),
    check("audit_event_actor_ck", sql`${t.actorType} <> 'user' OR ${t.actorUserId} IS NOT NULL`),
    foreignKey({ name: "audit_event_project_fk", columns: [t.workspaceId, t.projectId], foreignColumns: [project.workspaceId, project.id] }),
    foreignKey({ name: "audit_event_item_fk", columns: [t.workspaceId, t.equipmentItemId], foreignColumns: [equipmentItem.workspaceId, equipmentItem.id] }),
    foreignKey({ name: "audit_event_case_fk", columns: [t.workspaceId, t.caseId], foreignColumns: [equipmentCase.workspaceId, equipmentCase.id] }),
    foreignKey({ name: "audit_event_document_fk", columns: [t.workspaceId, t.documentId], foreignColumns: [document.workspaceId, document.id] }),
    foreignKey({ name: "audit_event_issue_fk", columns: [t.workspaceId, t.issueId], foreignColumns: [issue.workspaceId, issue.id] }),
    foreignKey({ name: "audit_event_rental_house_fk", columns: [t.workspaceId, t.rentalHouseId], foreignColumns: [rentalHouse.workspaceId, rentalHouse.id] }),
  ],
);
