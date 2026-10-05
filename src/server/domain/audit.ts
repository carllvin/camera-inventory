import { auditEvent, type AuditAction, type AuditChanges } from "../db/schema";
import type { DbOrTx } from "../db/client";
import type { Ctx } from "./context";

export interface AuditInput {
  action: AuditAction;
  entityType: "project" | "rental_house" | "category" | "equipment_type" | "equipment_item" | "case" | "case_template" | "document" | "issue";
  entityId: string;
  summary: string;
  projectId?: string | null;
  equipmentItemId?: string | null;
  caseId?: string | null;
  documentId?: string | null;
  issueId?: string | null;
  rentalHouseId?: string | null;
  changes?: AuditChanges | null;
  metadata?: Record<string, unknown> | null;
  correlationId?: string | null;
}

/** Append one immutable history event. Always call inside the transaction that made the change. */
export async function recordEvent(tx: DbOrTx, ctx: Ctx, e: AuditInput) {
  await tx.insert(auditEvent).values({
    workspaceId: ctx.workspaceId,
    actorType: "user",
    actorUserId: ctx.userId,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    summary: e.summary,
    projectId: e.projectId ?? null,
    equipmentItemId: e.equipmentItemId ?? null,
    caseId: e.caseId ?? null,
    documentId: e.documentId ?? null,
    issueId: e.issueId ?? null,
    rentalHouseId: e.rentalHouseId ?? null,
    changes: e.changes ?? null,
    metadata: e.metadata ?? null,
    correlationId: e.correlationId ?? null,
  });
}

/** Build a {field: {from, to}} diff for the keys present in `next` that actually changed. */
export function diff<T extends Record<string, unknown>>(prev: T, next: Partial<T>): AuditChanges {
  const out: AuditChanges = {};
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined) continue;
    const before = prev[k];
    const same =
      before instanceof Date && v instanceof Date
        ? before.getTime() === v.getTime()
        : JSON.stringify(before ?? null) === JSON.stringify(v ?? null);
    if (!same) out[k] = { from: before ?? null, to: v ?? null };
  }
  return out;
}
