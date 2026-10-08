/** Read models for dashboard, history and the list pages of later-phase features. */
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import { withUndo } from "./revert";
import type { Ctx } from "./context";

export async function getDashboard(db: DbOrTx, ctx: Ctx) {
  const [counts] = await db.execute<{
    active_projects: number;
    on_projects: number;
    in_use: number;
    missing: number;
    open_issues: number;
    pending_documents: number;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM project WHERE workspace_id = ${ctx.workspaceId} AND status IN ('prep','shooting','wrap') AND archived_at IS NULL) AS active_projects,
      (SELECT coalesce(sum(quantity),0)::int FROM equipment_item WHERE workspace_id = ${ctx.workspaceId} AND project_id IS NOT NULL) AS on_projects,
      (SELECT coalesce(sum(quantity),0)::int FROM equipment_item WHERE workspace_id = ${ctx.workspaceId} AND status = 'in_use') AS in_use,
      (SELECT coalesce(sum(quantity),0)::int FROM equipment_item WHERE workspace_id = ${ctx.workspaceId} AND status = 'missing') AS missing,
      (SELECT count(*)::int FROM issue WHERE workspace_id = ${ctx.workspaceId} AND status IN ('open','in_progress')) AS open_issues,
      (SELECT count(*)::int FROM document WHERE workspace_id = ${ctx.workspaceId} AND status IN ('uploaded','processing','extracted')) AS pending_documents
  `);
  const recent = await listActivity(db, ctx, { limit: 12 });
  const issues = await listIssues(db, ctx, { openOnly: true, limit: 6 });
  return { counts: counts!, recent, issues };
}

export async function listActivity(db: DbOrTx, ctx: Ctx, opts: { projectId?: string; caseId?: string; limit?: number; before?: { atMicros: string; id: number } } = {}) {
  const where: SQL[] = [eq(s.auditEvent.workspaceId, ctx.workspaceId)];
  if (opts.projectId) where.push(eq(s.auditEvent.projectId, opts.projectId));
  if (opts.caseId) where.push(eq(s.auditEvent.caseId, opts.caseId));
  if (opts.before) {
    where.push(sql`(${s.auditEvent.occurredAt}, ${s.auditEvent.id}) < (to_timestamp(${opts.before.atMicros}::numeric / 1000000), ${opts.before.id})`);
  }
  return db
    .select({
      id: s.auditEvent.id,
      occurredAt: s.auditEvent.occurredAt,
      /** Microsecond timestamp for keyset pagination (JS Dates only hold milliseconds). */
      cursorMicros: sql<string>`(extract(epoch from ${s.auditEvent.occurredAt}) * 1000000)::bigint::text`,
      action: s.auditEvent.action,
      summary: s.auditEvent.summary,
      actorType: s.auditEvent.actorType,
      actorName: s.user.name,
      entityType: s.auditEvent.entityType,
      entityId: s.auditEvent.entityId,
      projectId: s.auditEvent.projectId,
      projectName: s.project.name,
      equipmentItemId: s.auditEvent.equipmentItemId,
      documentId: s.auditEvent.documentId,
      changes: s.auditEvent.changes,
      metadata: s.auditEvent.metadata,
      correlationId: s.auditEvent.correlationId,
    })
    .from(s.auditEvent)
    .leftJoin(s.user, eq(s.user.id, s.auditEvent.actorUserId))
    .leftJoin(s.project, eq(s.project.id, s.auditEvent.projectId))
    .where(and(...where))
    // Keyset order (occurred_at, id): stable even when events share a timestamp.
    .orderBy(desc(s.auditEvent.occurredAt), desc(s.auditEvent.id))
    .limit(opts.limit ?? 100)
    .then((rows) => withUndo(db, ctx, rows as (typeof rows[number] & { changes: Record<string, { from: unknown; to: unknown }> | null; metadata: Record<string, unknown> | null })[]));
}

export async function listIssues(db: DbOrTx, ctx: Ctx, opts: { projectId?: string; openOnly?: boolean; limit?: number } = {}) {
  const where: SQL[] = [eq(s.issue.workspaceId, ctx.workspaceId)];
  if (opts.projectId) where.push(eq(s.issue.projectId, opts.projectId));
  if (opts.openOnly) where.push(inArray(s.issue.status, ["open", "in_progress"]));
  return db
    .select({
      id: s.issue.id,
      type: s.issue.type,
      status: s.issue.status,
      severity: s.issue.severity,
      title: s.issue.title,
      description: s.issue.description,
      createdAt: s.issue.createdAt,
      resolvedAt: s.issue.resolvedAt,
      resolution: s.issue.resolution,
      projectId: s.issue.projectId,
      projectName: s.project.name,
      equipmentItemId: s.issue.equipmentItemId,
      caseId: s.issue.caseId,
      documentId: s.issue.documentId,
    })
    .from(s.issue)
    .leftJoin(s.project, eq(s.project.id, s.issue.projectId))
    .where(and(...where))
    .orderBy(
      sql`CASE ${s.issue.status} WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END`,
      sql`CASE ${s.issue.severity} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`,
      desc(s.issue.createdAt),
    )
    .limit(opts.limit ?? 200);
}

export async function listDocuments(db: DbOrTx, ctx: Ctx, opts: { projectId?: string } = {}) {
  const where: SQL[] = [eq(s.document.workspaceId, ctx.workspaceId)];
  if (opts.projectId) where.push(eq(s.document.projectId, opts.projectId));
  return db
    .select({
      id: s.document.id,
      kind: s.document.kind,
      status: s.document.status,
      documentNumber: s.document.documentNumber,
      documentDate: s.document.documentDate,
      title: s.document.title,
      projectId: s.document.projectId,
      projectName: s.project.name,
      rentalHouseName: s.rentalHouse.name,
      confirmedAt: s.document.confirmedAt,
      lineCount: sql<number>`(SELECT count(*)::int FROM document_line l WHERE l.document_id = "document"."id")`,
    })
    .from(s.document)
    .leftJoin(s.project, eq(s.project.id, s.document.projectId))
    .leftJoin(s.rentalHouse, eq(s.rentalHouse.id, s.document.rentalHouseId))
    .where(and(...where))
    .orderBy(desc(s.document.documentDate), desc(s.document.createdAt));
}

export async function getDocument(db: DbOrTx, ctx: Ctx, id: string) {
  const [doc] = await db
    .select({ doc: s.document, projectName: s.project.name, rentalHouseName: s.rentalHouse.name })
    .from(s.document)
    .leftJoin(s.project, eq(s.project.id, s.document.projectId))
    .leftJoin(s.rentalHouse, eq(s.rentalHouse.id, s.document.rentalHouseId))
    .where(and(eq(s.document.id, id), eq(s.document.workspaceId, ctx.workspaceId)));
  if (!doc) return null;
  const lines = await db
    .select({
      line: s.documentLine,
      typeName: s.equipmentType.name,
    })
    .from(s.documentLine)
    .leftJoin(s.equipmentType, eq(s.equipmentType.id, s.documentLine.matchedEquipmentTypeId))
    .where(eq(s.documentLine.documentId, id))
    .orderBy(s.documentLine.lineNumber);
  return { ...doc, lines };
}

export async function listMembers(db: DbOrTx, ctx: Ctx) {
  return db
    .select({ id: s.user.id, name: s.user.name, email: s.user.email, role: s.workspaceMember.role })
    .from(s.workspaceMember)
    .innerJoin(s.user, eq(s.user.id, s.workspaceMember.userId))
    .where(eq(s.workspaceMember.workspaceId, ctx.workspaceId))
    .orderBy(s.user.name);
}
