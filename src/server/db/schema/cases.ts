import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tsz, updatedAt } from "./_shared";
import { category, equipmentType } from "./catalog";
import { project, workspace } from "./workspace";

/** Reusable packing list ("A-Cam Case"), usable across projects. */
export const caseTemplate = pgTable(
  "case_template",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspace.id),
    name: text().notNull(),
    description: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: tsz(),
  },
  (t) => [
    unique("case_template_workspace_id_uq").on(t.workspaceId, t.id),
    uniqueIndex("case_template_name_uq")
      .on(t.workspaceId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} IS NULL`),
  ],
);

/**
 * Expected line in a template. Either a specific equipment type, a category
 * ("any battery"), or a free-text label — label is always present for display.
 */
export const caseTemplateItem = pgTable(
  "case_template_item",
  {
    id: id(),
    workspaceId: uuid().notNull(),
    templateId: uuid().notNull(),
    equipmentTypeId: uuid(),
    categoryId: uuid(),
    label: text().notNull(),
    quantity: integer().notNull().default(1),
    sortOrder: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.templateId),
    check("case_template_item_quantity_ck", sql`${t.quantity} >= 1`),
    foreignKey({
      name: "case_template_item_template_fk",
      columns: [t.workspaceId, t.templateId],
      foreignColumns: [caseTemplate.workspaceId, caseTemplate.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "case_template_item_type_fk",
      columns: [t.workspaceId, t.equipmentTypeId],
      foreignColumns: [equipmentType.workspaceId, equipmentType.id],
    }),
    foreignKey({
      name: "case_template_item_category_fk",
      columns: [t.workspaceId, t.categoryId],
      foreignColumns: [category.workspaceId, category.id],
    }),
  ],
);

/** Physical container on a project. Cases always belong to exactly one project. */
export const equipmentCase = pgTable(
  "equipment_case",
  {
    id: id(),
    workspaceId: uuid().notNull(),
    projectId: uuid().notNull(),
    templateId: uuid(),
    name: text().notNull(),
    /** Short label printed on the case, e.g. "A-CAM 1". */
    code: text(),
    barcode: text(),
    description: text(),
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: tsz(),
  },
  (t) => [
    unique("equipment_case_workspace_id_uq").on(t.workspaceId, t.id),
    // Target for equipment_item (project_id, case_id): guarantees item and case share a project.
    unique("equipment_case_project_id_uq").on(t.projectId, t.id),
    uniqueIndex("equipment_case_name_uq")
      .on(t.projectId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} IS NULL`),
    uniqueIndex("equipment_case_barcode_uq")
      .on(t.workspaceId, t.barcode)
      .where(sql`${t.barcode} IS NOT NULL`),
    foreignKey({
      name: "equipment_case_project_fk",
      columns: [t.workspaceId, t.projectId],
      foreignColumns: [project.workspaceId, project.id],
    }),
    foreignKey({
      name: "equipment_case_template_fk",
      columns: [t.workspaceId, t.templateId],
      foreignColumns: [caseTemplate.workspaceId, caseTemplate.id],
    }),
  ],
);

/** Expected contents of a specific case (copied from a template, then editable). */
export const caseExpectedItem = pgTable(
  "case_expected_item",
  {
    id: id(),
    workspaceId: uuid().notNull(),
    caseId: uuid().notNull(),
    equipmentTypeId: uuid(),
    categoryId: uuid(),
    label: text().notNull(),
    quantity: integer().notNull().default(1),
    sortOrder: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.caseId),
    check("case_expected_item_quantity_ck", sql`${t.quantity} >= 1`),
    foreignKey({
      name: "case_expected_item_case_fk",
      columns: [t.workspaceId, t.caseId],
      foreignColumns: [equipmentCase.workspaceId, equipmentCase.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "case_expected_item_type_fk",
      columns: [t.workspaceId, t.equipmentTypeId],
      foreignColumns: [equipmentType.workspaceId, equipmentType.id],
    }),
    foreignKey({
      name: "case_expected_item_category_fk",
      columns: [t.workspaceId, t.categoryId],
      foreignColumns: [category.workspaceId, category.id],
    }),
  ],
);
