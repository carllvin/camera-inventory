import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import { recordEvent } from "./audit";
import { DomainError, notFound, requireRole, type Ctx } from "./context";
import { lockItem } from "./equipment-items";
import { splitBulkItem } from "./item-split";
import { optionalText, optionalUuid } from "./validation";

/**
 * Taking equipment off a project without going through a return-note review:
 * whole cases or single items (bulk: some units). Nothing is deleted - the item
 * leaves the project, its assignment is closed with the reason and the history
 * records who did it. An optional photo of the return note is attached as a
 * return-note document; once read it double-checks the removal (see
 * matchReturnLines: items removed with that note count as matched).
 */
export const removalInput = z.object({
  projectId: z.uuid(),
  /** returned: went back to the rental house. removed: added by mistake, never really here, … */
  reason: z.enum(["returned", "removed"]).default("returned"),
  note: optionalText(1000),
  returnDocumentId: optionalUuid,
});

export type RemovalSelection = {
  items?: { id: string; units?: number }[];
  /** Interchangeable units (no serial) spread over several entries: take this many, whole entries first. */
  groups?: { itemIds: string[]; units: number }[];
  caseIds?: string[];
};

export async function removeEquipment(db: DbOrTx, ctx: Ctx, input: z.input<typeof removalInput>, selection: RemovalSelection) {
  requireRole(ctx, "member");
  const data = removalInput.parse(input);
  const caseIds = [...new Set(selection.caseIds ?? [])];
  const picked = new Map<string, number | undefined>();
  for (const i of selection.items ?? []) picked.set(i.id, i.units);
  const groups = (selection.groups ?? []).filter((g) => g.itemIds.length > 0 && g.units > 0);
  if (picked.size === 0 && caseIds.length === 0 && groups.length === 0) throw new DomainError("VALIDATION", "Choose the sets or items to remove.");
  const correlationId = randomUUID();

  return db.transaction(async (tx) => {
    const [project] = await tx.select().from(s.project).where(and(eq(s.project.id, data.projectId), eq(s.project.workspaceId, ctx.workspaceId)));
    if (!project) notFound("Project");
    if (data.returnDocumentId) {
      const [doc] = await tx.select().from(s.document).where(and(eq(s.document.id, data.returnDocumentId), eq(s.document.workspaceId, ctx.workspaceId)));
      if (!doc || doc.kind !== "return_note" || doc.projectId !== project.id) throw new DomainError("VALIDATION", "The return note belongs to another project.");
    }

    const cases = caseIds.length
      ? await tx
          .select()
          .from(s.equipmentCase)
          .where(and(inArray(s.equipmentCase.id, caseIds), eq(s.equipmentCase.workspaceId, ctx.workspaceId)))
          .for("update")
      : [];
    if (cases.length !== caseIds.length || cases.some((c) => c.projectId !== project.id)) throw new DomainError("VALIDATION", "A chosen set is not on this project.");
    if (cases.length) {
      const inCases = await tx
        .select({ id: s.equipmentItem.id })
        .from(s.equipmentItem)
        .where(inArray(s.equipmentItem.caseId, caseIds))
        .orderBy(asc(s.equipmentItem.id));
      for (const i of inCases) picked.set(i.id, undefined); // a whole case takes everything in it
    }

    for (const g of groups) {
      const rows = await tx
        .select({ id: s.equipmentItem.id, quantity: s.equipmentItem.quantity })
        .from(s.equipmentItem)
        .where(and(inArray(s.equipmentItem.id, g.itemIds), eq(s.equipmentItem.workspaceId, ctx.workspaceId), eq(s.equipmentItem.projectId, project.id)))
        .orderBy(asc(s.equipmentItem.quantity), asc(s.equipmentItem.id));
      let left = g.units;
      for (const r of rows) {
        if (left === 0 || picked.has(r.id)) continue;
        picked.set(r.id, r.quantity <= left ? undefined : left);
        left -= Math.min(left, r.quantity);
      }
    }

    let units = 0;
    const houses = new Set<string | null>();
    const now = new Date();
    for (const [id, want] of [...picked.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const locked = await lockItem(tx, ctx, id);
      if (locked.projectId !== project.id) throw new DomainError("CONFLICT", `${locked.label} is no longer on ${project.name}. Reload the page.`);
      const item = want !== undefined && want < locked.quantity ? await splitBulkItem(tx, ctx, locked, want, { reason: "removed from project", correlationId }) : locked;
      const back = data.reason === "returned" && item.rentalHouseId !== null;
      const status = back ? ("returned" as const) : ("available" as const);
      await tx
        .update(s.equipmentItem)
        .set({ projectId: null, caseId: null, status, version: sql`${s.equipmentItem.version} + 1` })
        .where(eq(s.equipmentItem.id, item.id));
      await tx
        .update(s.projectAssignment)
        .set({ endedAt: now, endedById: ctx.userId, endReason: data.reason, returnDocumentId: data.returnDocumentId ?? null })
        .where(and(eq(s.projectAssignment.equipmentItemId, item.id), isNull(s.projectAssignment.endedAt)));
      const meta = { note: data.note, reason: data.reason, withoutReview: true };
      if (item.caseId) {
        await recordEvent(tx, ctx, {
          action: "equipment_item.removed_from_case",
          entityType: "equipment_item",
          entityId: item.id,
          equipmentItemId: item.id,
          caseId: item.caseId,
          projectId: project.id,
          summary: `${item.label} taken out of its set`,
          changes: { case_id: { from: item.caseId, to: null } },
          correlationId,
        });
      }
      await recordEvent(tx, ctx, {
        action: back ? "equipment_item.returned" : "equipment_item.removed_from_project",
        entityType: "equipment_item",
        entityId: item.id,
        equipmentItemId: item.id,
        projectId: project.id,
        rentalHouseId: item.rentalHouseId,
        documentId: data.returnDocumentId ?? null,
        summary: back ? `${item.label} returned (removed from ${project.name})` : `${item.label} removed from ${project.name}`,
        changes: { status: { from: item.status, to: status }, project_id: { from: project.id, to: null } },
        metadata: meta,
        correlationId,
      });
      units += item.quantity;
      houses.add(item.rentalHouseId);
    }

    // The note comes from the one rental house everything belongs to: fill it in for the review.
    if (data.returnDocumentId && houses.size === 1) {
      const [only] = [...houses];
      if (only) await tx.update(s.document).set({ rentalHouseId: only }).where(and(eq(s.document.id, data.returnDocumentId), isNull(s.document.rentalHouseId)));
    }

    for (const c of cases) {
      if (c.archivedAt) continue;
      await tx.update(s.equipmentCase).set({ archivedAt: now }).where(eq(s.equipmentCase.id, c.id));
      await recordEvent(tx, ctx, {
        action: "case.archived",
        entityType: "case",
        entityId: c.id,
        caseId: c.id,
        projectId: project.id,
        summary: `Set ${c.name} removed from ${project.name} with its contents`,
        metadata: { note: data.note, reason: data.reason },
        correlationId,
      });
    }
    return { items: picked.size, units, cases: cases.length, correlationId };
  });
}

/** Items removed from the project with this return note (for the double check). */
export async function itemsRemovedWithNote(db: DbOrTx, workspaceId: string, documentId: string) {
  return db
    .select({
      id: s.equipmentItem.id,
      equipmentTypeId: s.equipmentItem.equipmentTypeId,
      typeName: s.equipmentType.name,
      trackingMode: s.equipmentItem.trackingMode,
      quantity: s.projectAssignment.quantity,
      serialNumber: s.equipmentItem.serialNumber,
      assetNumber: s.equipmentItem.assetNumber,
      rentalHouseId: s.equipmentItem.rentalHouseId,
      rentalHouseName: s.rentalHouse.name,
    })
    .from(s.projectAssignment)
    .innerJoin(s.equipmentItem, eq(s.equipmentItem.id, s.projectAssignment.equipmentItemId))
    .innerJoin(s.equipmentType, eq(s.equipmentType.id, s.equipmentItem.equipmentTypeId))
    .leftJoin(s.rentalHouse, eq(s.rentalHouse.id, s.equipmentItem.rentalHouseId))
    .where(
      and(
        eq(s.projectAssignment.workspaceId, workspaceId),
        eq(s.projectAssignment.returnDocumentId, documentId),
        isNotNull(s.projectAssignment.endedAt),
        isNull(s.equipmentItem.projectId),
      ),
    )
    .orderBy(asc(s.equipmentType.name), asc(s.equipmentItem.serialNumber));
}
