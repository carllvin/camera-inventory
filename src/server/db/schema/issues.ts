import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tsz, updatedAt } from "./_shared";
import { user } from "./auth";
import { equipmentCase } from "./cases";
import { document } from "./documents";
import { issueSeverity, issueStatus, issueType } from "./enums";
import { equipmentItem } from "./inventory";
import { project, workspace } from "./workspace";

export const issue = pgTable(
  "issue",
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspace.id),
    type: issueType().notNull(),
    status: issueStatus().notNull().default("open"),
    severity: issueSeverity().notNull().default("medium"),
    title: text().notNull(),
    description: text(),
    projectId: uuid(),
    equipmentItemId: uuid(),
    caseId: uuid(),
    documentId: uuid(),
    createdById: uuid().references(() => user.id),
    resolvedById: uuid().references(() => user.id),
    resolvedAt: tsz(),
    resolution: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("issue_workspace_id_uq").on(t.workspaceId, t.id),
    index().on(t.workspaceId, t.status),
    index().on(t.projectId, t.status),
    index().on(t.equipmentItemId),
    index().on(t.caseId),
    index().on(t.documentId),
    check(
      "issue_resolution_ck",
      sql`(${t.status} IN ('resolved', 'dismissed')) = (${t.resolvedAt} IS NOT NULL)`,
    ),
    foreignKey({
      name: "issue_project_fk",
      columns: [t.workspaceId, t.projectId],
      foreignColumns: [project.workspaceId, project.id],
    }),
    foreignKey({
      name: "issue_item_fk",
      columns: [t.workspaceId, t.equipmentItemId],
      foreignColumns: [equipmentItem.workspaceId, equipmentItem.id],
    }),
    foreignKey({
      name: "issue_case_fk",
      columns: [t.workspaceId, t.caseId],
      foreignColumns: [equipmentCase.workspaceId, equipmentCase.id],
    }),
    foreignKey({
      name: "issue_document_fk",
      columns: [t.workspaceId, t.documentId],
      foreignColumns: [document.workspaceId, document.id],
    }),
  ],
);
