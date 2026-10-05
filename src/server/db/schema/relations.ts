/** Drizzle relational-query metadata (does not affect the SQL schema). */
import { relations } from "drizzle-orm";
import { auditEvent } from "./audit";
import { user } from "./auth";
import { caseExpectedItem, caseTemplate, caseTemplateItem, equipmentCase } from "./cases";
import { category, equipmentType, projectRentalHouse, rentalHouse } from "./catalog";
import { document, documentFile, documentLine } from "./documents";
import { equipmentItem, projectAssignment } from "./inventory";
import { issue } from "./issues";
import { photo } from "./media";
import { project, workspace, workspaceMember } from "./workspace";

export const workspaceRelations = relations(workspace, ({ many }) => ({
  members: many(workspaceMember),
  projects: many(project),
}));

export const workspaceMemberRelations = relations(workspaceMember, ({ one }) => ({
  workspace: one(workspace, { fields: [workspaceMember.workspaceId], references: [workspace.id] }),
  user: one(user, { fields: [workspaceMember.userId], references: [user.id] }),
}));

export const projectRelations = relations(project, ({ one, many }) => ({
  workspace: one(workspace, { fields: [project.workspaceId], references: [workspace.id] }),
  items: many(equipmentItem),
  cases: many(equipmentCase),
  rentalHouses: many(projectRentalHouse),
  documents: many(document),
  issues: many(issue),
}));

export const rentalHouseRelations = relations(rentalHouse, ({ many }) => ({
  items: many(equipmentItem),
  projects: many(projectRentalHouse),
}));

export const projectRentalHouseRelations = relations(projectRentalHouse, ({ one }) => ({
  project: one(project, { fields: [projectRentalHouse.projectId], references: [project.id] }),
  rentalHouse: one(rentalHouse, { fields: [projectRentalHouse.rentalHouseId], references: [rentalHouse.id] }),
}));

export const categoryRelations = relations(category, ({ one, many }) => ({
  parent: one(category, { fields: [category.parentId], references: [category.id], relationName: "category_tree" }),
  children: many(category, { relationName: "category_tree" }),
  equipmentTypes: many(equipmentType),
}));

export const equipmentTypeRelations = relations(equipmentType, ({ one, many }) => ({
  category: one(category, { fields: [equipmentType.categoryId], references: [category.id] }),
  items: many(equipmentItem),
  photos: many(photo),
}));

export const equipmentItemRelations = relations(equipmentItem, ({ one, many }) => ({
  equipmentType: one(equipmentType, { fields: [equipmentItem.equipmentTypeId], references: [equipmentType.id] }),
  rentalHouse: one(rentalHouse, { fields: [equipmentItem.rentalHouseId], references: [rentalHouse.id] }),
  project: one(project, { fields: [equipmentItem.projectId], references: [project.id] }),
  case: one(equipmentCase, { fields: [equipmentItem.caseId], references: [equipmentCase.id] }),
  assignments: many(projectAssignment),
  photos: many(photo),
  issues: many(issue),
  events: many(auditEvent),
}));

export const projectAssignmentRelations = relations(projectAssignment, ({ one }) => ({
  equipmentItem: one(equipmentItem, { fields: [projectAssignment.equipmentItemId], references: [equipmentItem.id] }),
  project: one(project, { fields: [projectAssignment.projectId], references: [project.id] }),
  rentalHouse: one(rentalHouse, { fields: [projectAssignment.rentalHouseId], references: [rentalHouse.id] }),
  deliveryDocument: one(document, { fields: [projectAssignment.deliveryDocumentId], references: [document.id], relationName: "delivery_assignments" }),
  returnDocument: one(document, { fields: [projectAssignment.returnDocumentId], references: [document.id], relationName: "return_assignments" }),
}));

export const caseTemplateRelations = relations(caseTemplate, ({ many }) => ({
  items: many(caseTemplateItem),
  cases: many(equipmentCase),
}));

export const caseTemplateItemRelations = relations(caseTemplateItem, ({ one }) => ({
  template: one(caseTemplate, { fields: [caseTemplateItem.templateId], references: [caseTemplate.id] }),
  equipmentType: one(equipmentType, { fields: [caseTemplateItem.equipmentTypeId], references: [equipmentType.id] }),
  category: one(category, { fields: [caseTemplateItem.categoryId], references: [category.id] }),
}));

export const equipmentCaseRelations = relations(equipmentCase, ({ one, many }) => ({
  project: one(project, { fields: [equipmentCase.projectId], references: [project.id] }),
  template: one(caseTemplate, { fields: [equipmentCase.templateId], references: [caseTemplate.id] }),
  expectedItems: many(caseExpectedItem),
  items: many(equipmentItem),
  photos: many(photo),
}));

export const caseExpectedItemRelations = relations(caseExpectedItem, ({ one }) => ({
  case: one(equipmentCase, { fields: [caseExpectedItem.caseId], references: [equipmentCase.id] }),
  equipmentType: one(equipmentType, { fields: [caseExpectedItem.equipmentTypeId], references: [equipmentType.id] }),
  category: one(category, { fields: [caseExpectedItem.categoryId], references: [category.id] }),
}));

export const documentRelations = relations(document, ({ one, many }) => ({
  project: one(project, { fields: [document.projectId], references: [project.id] }),
  rentalHouse: one(rentalHouse, { fields: [document.rentalHouseId], references: [rentalHouse.id] }),
  files: many(documentFile),
  lines: many(documentLine),
  deliveryAssignments: many(projectAssignment, { relationName: "delivery_assignments" }),
  returnAssignments: many(projectAssignment, { relationName: "return_assignments" }),
}));

export const documentFileRelations = relations(documentFile, ({ one }) => ({
  document: one(document, { fields: [documentFile.documentId], references: [document.id] }),
}));

export const documentLineRelations = relations(documentLine, ({ one }) => ({
  document: one(document, { fields: [documentLine.documentId], references: [document.id] }),
  matchedEquipmentType: one(equipmentType, { fields: [documentLine.matchedEquipmentTypeId], references: [equipmentType.id] }),
  matchedEquipmentItem: one(equipmentItem, { fields: [documentLine.matchedEquipmentItemId], references: [equipmentItem.id] }),
}));

export const issueRelations = relations(issue, ({ one, many }) => ({
  project: one(project, { fields: [issue.projectId], references: [project.id] }),
  equipmentItem: one(equipmentItem, { fields: [issue.equipmentItemId], references: [equipmentItem.id] }),
  case: one(equipmentCase, { fields: [issue.caseId], references: [equipmentCase.id] }),
  document: one(document, { fields: [issue.documentId], references: [document.id] }),
  photos: many(photo),
}));

export const photoRelations = relations(photo, ({ one }) => ({
  equipmentType: one(equipmentType, { fields: [photo.equipmentTypeId], references: [equipmentType.id] }),
  equipmentItem: one(equipmentItem, { fields: [photo.equipmentItemId], references: [equipmentItem.id] }),
  case: one(equipmentCase, { fields: [photo.caseId], references: [equipmentCase.id] }),
  issue: one(issue, { fields: [photo.issueId], references: [issue.id] }),
}));

export const auditEventRelations = relations(auditEvent, ({ one }) => ({
  actor: one(user, { fields: [auditEvent.actorUserId], references: [user.id] }),
  equipmentItem: one(equipmentItem, { fields: [auditEvent.equipmentItemId], references: [equipmentItem.id] }),
  project: one(project, { fields: [auditEvent.projectId], references: [project.id] }),
}));
