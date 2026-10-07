/**
 * Undo from the history. History is append-only: an undo never edits or deletes
 * events, it makes the opposite change through the normal services (so every rule
 * still holds) and those new events are marked `revertOf` the original.
 * Only simple, still-current changes can be undone; anything that changed again
 * since must be undone newest first.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import { recordEvent } from "./audit";
import { packItem, unpackItem } from "./cases";
import { DomainError, notFound, requireRole, type Ctx } from "./context";
import { assignToProject, changeCondition, changeStatus, lockItem, ON_PROJECT_STATUSES, removeFromProject, updateItem } from "./equipment-items";

type Changes = Record<string, { from: unknown; to: unknown }>;
type EventLike = { action: string; changes?: Changes | null; metadata?: Record<string, unknown> | null; documentId?: string | null };

const ITEM_FIELDS = ["serialNumber", "assetNumber", "barcode", "rentalHouseId", "notes", "quantity"];
const TYPE_FIELDS = ["manufacturer", "model", "name", "categoryId", "aliases", "description", "specs", "defaultTrackingMode"];
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Can this history event be undone (by kind; whether it is still current is checked on undo)? */
export function isRevertible(e: EventLike) {
  const c = e.changes ?? {};
  const keys = Object.keys(c);
  // An undo is not undone again (that would only blur the history; make the change anew).
  if (e.metadata?.revertOf) return false;
  // Document-driven changes (deliveries, return notes) are corrected on the document, not here.
  if (e.documentId && !e.metadata?.withoutReview) return false;
  switch (e.action) {
    case "equipment_item.status_changed":
      return "status" in c;
    case "equipment_item.condition_changed":
      return "condition" in c;
    case "equipment_item.added_to_case":
    case "equipment_item.removed_from_case":
      return "case_id" in c;
    case "equipment_item.updated":
      return keys.length > 0 && keys.every((k) => ITEM_FIELDS.includes(k));
    case "equipment_item.assigned_to_project":
      return c.project_id?.from == null && Boolean(c.project_id?.to);
    case "equipment_item.removed_from_project":
    case "equipment_item.returned":
      return Boolean(c.project_id?.from) && c.project_id?.to == null && (e.action === "equipment_item.removed_from_project" || Boolean(e.metadata?.withoutReview));
    case "equipment_type.updated":
    case "equipment_type.alias_learned":
      return keys.length > 0 && keys.every((k) => TYPE_FIELDS.includes(k));
    default:
      return false;
  }
}

/** Which of these events were undone already. */
export async function undoneEventIds(db: DbOrTx, workspaceId: string, ids: number[]) {
  if (ids.length === 0) return new Set<number>();
  const rows = await db
    .select({ of: sql<string>`${s.auditEvent.metadata}->>'revertOf'` })
    .from(s.auditEvent)
    .where(and(eq(s.auditEvent.workspaceId, workspaceId), inArray(sql`(${s.auditEvent.metadata}->>'revertOf')`, ids.map(String))));
  return new Set(rows.map((r) => Number(r.of)));
}

const changedSince = () => new DomainError("CONFLICT", "This was changed again since. Undo the newer change first (newest first).");

export async function revertEvent(db: DbOrTx, ctx: Ctx, eventId: number) {
  requireRole(ctx, "member");
  const [e] = await db.select().from(s.auditEvent).where(and(eq(s.auditEvent.id, eventId), eq(s.auditEvent.workspaceId, ctx.workspaceId)));
  if (!e) notFound("History entry");
  const changes = (e.changes ?? {}) as Changes;
  if (!isRevertible({ ...e, changes, metadata: e.metadata as Record<string, unknown> | null })) {
    throw new DomainError("VALIDATION", "This change cannot be undone here.");
  }
  if ((await undoneEventIds(db, ctx.workspaceId, [eventId])).has(eventId)) throw new DomainError("CONFLICT", "This change was undone already.");
  const rctx: Ctx = { ...ctx, revertOf: eventId };

  return db.transaction(async (tx) => {
    if (e.entityType === "equipment_type") {
      const [type] = await tx.select().from(s.equipmentType).where(and(eq(s.equipmentType.id, e.entityId), eq(s.equipmentType.workspaceId, ctx.workspaceId))).for("update");
      if (!type) notFound("Equipment type");
      const current = type as unknown as Record<string, unknown>;
      for (const [k, v] of Object.entries(changes)) if (!same(current[k], v.to)) throw changedSince();
      const restore = Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.from ?? null]));
      await tx.update(s.equipmentType).set(restore).where(eq(s.equipmentType.id, type.id));
      await recordEvent(tx, rctx, {
        action: "equipment_type.updated",
        entityType: "equipment_type",
        entityId: type.id,
        summary: `${type.name}: ${Object.keys(changes).join(", ")} restored`,
        changes: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, { from: v.to, to: v.from }])),
      });
      return { summary: e.summary };
    }

    const item = await lockItem(tx, ctx, e.entityId);
    switch (e.action) {
      case "equipment_item.status_changed": {
        const { from, to } = changes.status!;
        if (item.status !== to) throw changedSince();
        if (!ON_PROJECT_STATUSES.includes(from as never) || !item.projectId) throw new DomainError("VALIDATION", "That status can only be restored on a project.");
        await changeStatus(tx, rctx, item.id, { status: from as (typeof ON_PROJECT_STATUSES)[number] });
        break;
      }
      case "equipment_item.condition_changed": {
        const { from, to } = changes.condition!;
        if (item.condition !== to) throw changedSince();
        await changeCondition(tx, rctx, item.id, { condition: from as never });
        break;
      }
      case "equipment_item.added_to_case":
      case "equipment_item.removed_from_case": {
        const { from, to } = changes.case_id!;
        if ((item.caseId ?? null) !== (to ?? null)) throw changedSince();
        if (from) await packItem(tx, rctx, from as string, item.id, { allowMove: true });
        else await unpackItem(tx, rctx, item.id);
        break;
      }
      case "equipment_item.updated": {
        const current = item as unknown as Record<string, unknown>;
        for (const [k, v] of Object.entries(changes)) if (!same(current[k], v.to)) throw changedSince();
        const restore = Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.from ?? null]));
        await updateItem(tx, rctx, item.id, {
          serialNumber: item.serialNumber,
          assetNumber: item.assetNumber,
          barcode: item.barcode,
          rentalHouseId: item.rentalHouseId,
          notes: item.notes,
          quantity: item.trackingMode === "bulk" ? item.quantity : undefined,
          ...(restore as Record<string, never>),
        });
        break;
      }
      case "equipment_item.assigned_to_project": {
        if (item.projectId !== changes.project_id!.to) throw changedSince();
        await removeFromProject(tx, rctx, item.id, { reason: `Undo: ${e.summary}` });
        break;
      }
      case "equipment_item.removed_from_project":
      case "equipment_item.returned": {
        if (item.projectId) throw changedSince();
        await assignToProject(tx, rctx, item.id, { projectId: changes.project_id!.from as string, note: `Undo: ${e.summary}` });
        break;
      }
    }
    return { summary: e.summary };
  });
}

/** Mark history events for the UI: "can" = Undo button, "done" = already undone. */
export async function withUndo<T extends { id: number } & EventLike>(db: DbOrTx, ctx: Ctx, events: T[]) {
  const undone = await undoneEventIds(db, ctx.workspaceId, events.map((e) => e.id));
  const member = ctx.role !== "viewer";
  return events.map((e) => ({
    ...e,
    undo: undone.has(e.id) ? ("done" as const) : member && isRevertible(e) ? ("can" as const) : null,
  }));
}
