import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, integer, pgTable, real, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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

/**
 * Cached image-search results for an equipment type's reference image picker,
 * so reopening the picker is instant and does not cost another search.
 */
export const imageCandidate = pgTable(
  "image_candidate",
  {
    id: id(),
    workspaceId: uuid().notNull(),
    equipmentTypeId: uuid().notNull(),
    query: text().notNull(),
    source: text().notNull(),
    imageUrl: text().notNull(),
    thumbnailUrl: text(),
    pageUrl: text(),
    title: text(),
    sourceDomain: text(),
    width: integer(),
    height: integer(),
    rank: integer().notNull(),
    /** 0–1 suitability from the AI ranking (null when not ranked). */
    score: real(),
    aiNote: text(),
    fetchedAt: createdAt(),
  },
  (t) => [
    index().on(t.equipmentTypeId, t.rank),
    foreignKey({
      name: "image_candidate_type_fk",
      columns: [t.workspaceId, t.equipmentTypeId],
      foreignColumns: [equipmentType.workspaceId, equipmentType.id],
    }).onDelete("cascade"),
  ],
);

/**
 * Background run of "find a reference image automatically" over many equipment
 * types (Settings → Automatic images). Progress lives here so a restart loses
 * nothing: the job can be resumed and every type's outcome stays visible.
 */
export const imageJob = pgTable(
  "image_job",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspace.id),
    /** running | done | cancelled | failed | interrupted */
    status: text().notNull().default("running"),
    /** in_use: only types with items; all: every type without an image */
    scope: text().notNull(),
    total: integer().notNull().default(0),
    processed: integer().notNull().default(0),
    applied: integer().notNull().default(0),
    cancelRequested: boolean().notNull().default(false),
    lastError: text(),
    startedById: uuid().references(() => user.id),
    createdAt: createdAt(),
    /** Heartbeat while running; a stale running job counts as interrupted. */
    updatedAt: tsz().notNull().defaultNow(),
    finishedAt: tsz(),
  },
  (t) => [
    unique("image_job_workspace_id_uq").on(t.workspaceId, t.id),
    // One running job per workspace.
    uniqueIndex("image_job_one_running_uq").on(t.workspaceId).where(sql`${t.status} = 'running'`),
    check("image_job_status_ck", sql`${t.status} IN ('running', 'done', 'cancelled', 'failed', 'interrupted')`),
    check("image_job_scope_ck", sql`${t.scope} IN ('in_use', 'all')`),
  ],
);

export const imageJobItem = pgTable(
  "image_job_item",
  {
    id: id(),
    workspaceId: uuid().notNull(),
    jobId: uuid().notNull(),
    equipmentTypeId: uuid().notNull(),
    sortOrder: integer().notNull(),
    /** pending | applied | has_image | not_confident | download_failed | error */
    result: text().notNull().default("pending"),
    note: text(),
    photoId: uuid(),
    processedAt: tsz(),
  },
  (t) => [
    index().on(t.jobId, t.sortOrder),
    index().on(t.equipmentTypeId),
    check("image_job_item_result_ck", sql`${t.result} IN ('pending', 'applied', 'has_image', 'not_confident', 'download_failed', 'error')`),
    foreignKey({ name: "image_job_item_job_fk", columns: [t.workspaceId, t.jobId], foreignColumns: [imageJob.workspaceId, imageJob.id] }).onDelete("cascade"),
    foreignKey({ name: "image_job_item_type_fk", columns: [t.workspaceId, t.equipmentTypeId], foreignColumns: [equipmentType.workspaceId, equipmentType.id] }).onDelete("cascade"),
  ],
);
