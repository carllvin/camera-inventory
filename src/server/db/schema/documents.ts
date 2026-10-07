import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, tsz, updatedAt } from "./_shared";
import { user } from "./auth";
import { equipmentType, rentalHouse } from "./catalog";
import { documentKind, documentLineResolution, documentStatus } from "./enums";
import { equipmentItem } from "./inventory";
import { project, workspace } from "./workspace";

/**
 * Delivery note / return note. Inventory only changes when a user confirms
 * the reviewed extraction (status -> confirmed).
 */
export const document = pgTable(
  "document",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspace.id),
    kind: documentKind().notNull(),
    status: documentStatus().notNull().default("uploaded"),
    projectId: uuid(),
    /** How the project was set: chosen at upload, detected from the document, or picked in review. */
    projectSource: text(),
    rentalHouseId: uuid(),
    documentNumber: text(),
    documentDate: date({ mode: "string" }),
    title: text(),
    /** Raw structured AI output, kept verbatim for traceability. */
    extraction: jsonb().$type<Record<string, unknown>>(),
    extractionProvider: text(),
    extractionModel: text(),
    extractionError: text(),
    extractedAt: tsz(),
    /** Set when the user is warned this looks like an already imported document. */
    possibleDuplicateOfId: uuid(),
    uploadedById: uuid().references(() => user.id),
    confirmedById: uuid().references(() => user.id),
    confirmedAt: tsz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("document_workspace_id_uq").on(t.workspaceId, t.id),
    index().on(t.projectId, t.kind),
    index("document_number_idx").on(t.workspaceId, t.rentalHouseId, t.kind, sql`upper(${t.documentNumber})`),
    check(
      "document_confirmed_ck",
      sql`${t.status} <> 'confirmed' OR (${t.confirmedAt} IS NOT NULL AND ${t.projectId} IS NOT NULL)`,
    ),
    check("document_project_source_ck", sql`${t.projectSource} IS NULL OR ${t.projectSource} IN ('upload', 'detected', 'reviewer')`),
    foreignKey({
      name: "document_project_fk",
      columns: [t.workspaceId, t.projectId],
      foreignColumns: [project.workspaceId, project.id],
    }),
    foreignKey({
      name: "document_rental_house_fk",
      columns: [t.workspaceId, t.rentalHouseId],
      foreignColumns: [rentalHouse.workspaceId, rentalHouse.id],
    }),
    foreignKey({
      name: "document_duplicate_fk",
      columns: [t.workspaceId, t.possibleDuplicateOfId],
      foreignColumns: [t.workspaceId, t.id],
    }),
  ],
);

/** Uploaded file(s) of a document (one PDF, or several photos of a paper note). */
export const documentFile = pgTable(
  "document_file",
  {
    id: id(),
    workspaceId: uuid().notNull(),
    documentId: uuid().notNull(),
    /** Key in object storage — never a public URL. */
    storageKey: text().notNull(),
    fileName: text().notNull(),
    mimeType: text().notNull(),
    sizeBytes: bigint({ mode: "number" }).notNull(),
    sha256: text().notNull(),
    pageCount: integer(),
    sortOrder: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.documentId),
    index().on(t.workspaceId, t.sha256),
    foreignKey({
      name: "document_file_document_fk",
      columns: [t.workspaceId, t.documentId],
      foreignColumns: [document.workspaceId, document.id],
    }),
  ],
);

/** One extracted line with its matching result and the user's review decision. */
export const documentLine = pgTable(
  "document_line",
  {
    id: id(),
    workspaceId: uuid().notNull(),
    documentId: uuid().notNull(),
    lineNumber: integer().notNull(),
    rawText: text(),
    description: text().notNull(),
    manufacturer: text(),
    model: text(),
    quantity: integer().notNull().default(1),
    serialNumber: text(),
    assetNumber: text(),
    aiConfidence: real(),
    matchedEquipmentTypeId: uuid(),
    matchedEquipmentItemId: uuid(),
    matchConfidence: real(),
    matchReason: text(),
    resolution: documentLineResolution().notNull().default("pending"),
    /** The reviewer picked the type/item by hand; re-matching keeps that choice. */
    reviewerChoice: boolean().notNull().default(false),
    confirmedQuantity: integer(),
    /** AI help for creating the type when it is not known yet: category path and tracking mode. */
    suggestedCategory: text(),
    suggestedTracking: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("document_line_number_uq").on(t.documentId, t.lineNumber),
    index().on(t.matchedEquipmentItemId),
    check("document_line_quantity_ck", sql`${t.quantity} >= 0`),
    check(
      "document_line_confidence_ck",
      sql`(${t.aiConfidence} IS NULL OR ${t.aiConfidence} BETWEEN 0 AND 1) AND (${t.matchConfidence} IS NULL OR ${t.matchConfidence} BETWEEN 0 AND 1)`,
    ),
    foreignKey({
      name: "document_line_document_fk",
      columns: [t.workspaceId, t.documentId],
      foreignColumns: [document.workspaceId, document.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "document_line_type_fk",
      columns: [t.workspaceId, t.matchedEquipmentTypeId],
      foreignColumns: [equipmentType.workspaceId, equipmentType.id],
    }),
    foreignKey({
      name: "document_line_item_fk",
      columns: [t.workspaceId, t.matchedEquipmentItemId],
      foreignColumns: [equipmentItem.workspaceId, equipmentItem.id],
    }),
  ],
);
