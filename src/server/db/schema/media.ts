import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tsz } from "./_shared";
import { user } from "./auth";
import { equipmentCase } from "./cases";
import { equipmentType } from "./catalog";
import { photoKind } from "./enums";
import { equipmentItem } from "./inventory";
import { issue } from "./issues";
import { project, workspace } from "./workspace";

/**
 * Image in object storage, attached to one or more subjects.
 * Reference images belong to equipment types; photos are never mandatory for items.
 */
export const photo = pgTable(
  "photo",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspace.id),
    kind: photoKind().notNull(),
    /** Normalized full-size image (EXIF-rotated, metadata stripped). */
    storageKey: text().notNull(),
    /** Small preview for lists and grids. */
    thumbnailKey: text(),
    mimeType: text().notNull(),
    width: integer(),
    height: integer(),
    sizeBytes: bigint({ mode: "number" }),
    sha256: text(),
    caption: text(),
    /** Where an external reference image came from (manufacturer page, image search). */
    sourceUrl: text(),
    attribution: text(),
    /** Primary reference image of an equipment type. */
    isPrimary: boolean().notNull().default(false),
    takenAt: tsz(),
    uploadedById: uuid().references(() => user.id),
    equipmentTypeId: uuid(),
    equipmentItemId: uuid(),
    caseId: uuid(),
    projectId: uuid(),
    issueId: uuid(),
    createdAt: createdAt(),
    /** Hidden from galleries; the file and row are kept for the history. */
    removedAt: tsz(),
    removedById: uuid().references(() => user.id),
  },
  (t) => [
    index().on(t.equipmentTypeId),
    index().on(t.equipmentItemId),
    index().on(t.caseId),
    index().on(t.issueId),
    uniqueIndex("photo_primary_reference_uq")
      .on(t.equipmentTypeId)
      .where(sql`${t.isPrimary} AND ${t.kind} = 'reference'`),
    check(
      "photo_has_subject_ck",
      sql`num_nonnulls(${t.equipmentTypeId}, ${t.equipmentItemId}, ${t.caseId}, ${t.projectId}, ${t.issueId}) >= 1`,
    ),
    check("photo_reference_needs_type_ck", sql`${t.kind} <> 'reference' OR ${t.equipmentTypeId} IS NOT NULL`),
    foreignKey({
      name: "photo_type_fk",
      columns: [t.workspaceId, t.equipmentTypeId],
      foreignColumns: [equipmentType.workspaceId, equipmentType.id],
    }),
    foreignKey({
      name: "photo_item_fk",
      columns: [t.workspaceId, t.equipmentItemId],
      foreignColumns: [equipmentItem.workspaceId, equipmentItem.id],
    }),
    foreignKey({
      name: "photo_case_fk",
      columns: [t.workspaceId, t.caseId],
      foreignColumns: [equipmentCase.workspaceId, equipmentCase.id],
    }),
    foreignKey({
      name: "photo_project_fk",
      columns: [t.workspaceId, t.projectId],
      foreignColumns: [project.workspaceId, project.id],
    }),
    foreignKey({
      name: "photo_issue_fk",
      columns: [t.workspaceId, t.issueId],
      foreignColumns: [issue.workspaceId, issue.id],
    }),
  ],
);
