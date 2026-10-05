import { sql } from "drizzle-orm";
import { check, date, index, pgTable, primaryKey, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tsz, updatedAt } from "./_shared";
import { user } from "./auth";
import { projectStatus, workspaceRole } from "./enums";

/** Tenant boundary. Every business row carries workspace_id. */
export const workspace = pgTable(
  "workspace",
  {
    id: id(),
    name: text().notNull(),
    slug: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("workspace_slug_uq").on(sql`lower(${t.slug})`)],
);

export const workspaceMember = pgTable(
  "workspace_member",
  {
    workspaceId: uuid()
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: workspaceRole().notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index().on(t.userId)],
);

export const project = pgTable(
  "project",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspace.id),
    name: text().notNull(),
    /** Short production code, e.g. "FFX". */
    code: text(),
    status: projectStatus().notNull().default("prep"),
    productionCompany: text(),
    description: text(),
    startDate: date({ mode: "string" }),
    endDate: date({ mode: "string" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: tsz(),
  },
  (t) => [
    unique("project_workspace_id_uq").on(t.workspaceId, t.id),
    uniqueIndex("project_workspace_name_uq").on(t.workspaceId, sql`lower(${t.name})`),
    check("project_dates_ck", sql`${t.endDate} IS NULL OR ${t.startDate} IS NULL OR ${t.endDate} >= ${t.startDate}`),
  ],
);
