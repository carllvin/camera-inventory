import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, tsz, updatedAt } from "./_shared";
import { trackingMode } from "./enums";
import { project, workspace } from "./workspace";

/** Rental houses are independent entities, reused across projects. */
export const rentalHouse = pgTable(
  "rental_house",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspace.id),
    name: text().notNull(),
    shortName: text(),
    /** Alternative spellings seen on documents ("ARRI Rental Berlin", "ARRI Rental GmbH"). */
    aliases: text().array().notNull().default(sql`'{}'::text[]`),
    website: text(),
    email: text(),
    phone: text(),
    address: text(),
    notes: text(),
    /** Maintained by trigger; normalized text for fuzzy search. */
    searchText: text().notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: tsz(),
  },
  (t) => [
    unique("rental_house_workspace_id_uq").on(t.workspaceId, t.id),
    uniqueIndex("rental_house_workspace_name_uq").on(t.workspaceId, sql`lower(${t.name})`),
    index("rental_house_search_trgm_idx").using("gin", t.searchText.op("gin_trgm_ops")),
  ],
);

/**
 * Per-project relationship to a rental house (order reference, contact).
 * This row is never "closed" by a return: open equipment is derived from items.
 */
export const projectRentalHouse = pgTable(
  "project_rental_house",
  {
    id: id(),
    workspaceId: uuid().notNull(),
    projectId: uuid().notNull(),
    rentalHouseId: uuid().notNull(),
    orderReference: text(),
    contactName: text(),
    contactPhone: text(),
    contactEmail: text(),
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("project_rental_house_uq").on(t.projectId, t.rentalHouseId),
    index().on(t.rentalHouseId),
    foreignKey({
      name: "project_rental_house_project_fk",
      columns: [t.workspaceId, t.projectId],
      foreignColumns: [project.workspaceId, project.id],
    }),
    foreignKey({
      name: "project_rental_house_rental_house_fk",
      columns: [t.workspaceId, t.rentalHouseId],
      foreignColumns: [rentalHouse.workspaceId, rentalHouse.id],
    }),
  ],
);

/** Hierarchical, user-editable categories (Camera > Camera Bodies). Cycles are blocked by trigger. */
export const category = pgTable(
  "category",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspace.id),
    parentId: uuid(),
    name: text().notNull(),
    sortOrder: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("category_workspace_id_uq").on(t.workspaceId, t.id),
    // Sibling names are unique; root categories compare with a sentinel parent.
    uniqueIndex("category_sibling_name_uq").on(
      t.workspaceId,
      sql`coalesce(${t.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`lower(${t.name})`,
    ),
    index().on(t.parentId),
    foreignKey({
      name: "category_parent_fk",
      columns: [t.workspaceId, t.parentId],
      foreignColumns: [t.workspaceId, t.id],
    }),
  ],
);

/** Generic product/model, e.g. "ARRI ALEXA 35". Many physical items share one type. */
export const equipmentType = pgTable(
  "equipment_type",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspace.id),
    categoryId: uuid(),
    manufacturer: text().notNull(),
    model: text().notNull(),
    /** Display name; defaults to "manufacturer model" in the app layer. */
    name: text().notNull(),
    aliases: text().array().notNull().default(sql`'{}'::text[]`),
    description: text(),
    /** Free-form technical data: mount, weight, power, resolution, ... */
    specs: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    defaultTrackingMode: trackingMode().notNull().default("serialized"),
    searchText: text().notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: tsz(),
  },
  (t) => [
    unique("equipment_type_workspace_id_uq").on(t.workspaceId, t.id),
    uniqueIndex("equipment_type_model_uq").on(
      t.workspaceId,
      sql`lower(${t.manufacturer})`,
      sql`lower(${t.model})`,
    ),
    index().on(t.categoryId),
    index("equipment_type_search_trgm_idx").using("gin", t.searchText.op("gin_trgm_ops")),
    foreignKey({
      name: "equipment_type_category_fk",
      columns: [t.workspaceId, t.categoryId],
      foreignColumns: [category.workspaceId, category.id],
    }),
  ],
);
