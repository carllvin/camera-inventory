import { and, eq, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import { recordEvent } from "./audit";
import { DomainError, type Ctx } from "./context";
import type { lockItem } from "./equipment-items";

type LockedItem = Awaited<ReturnType<typeof lockItem>>;

/**
 * Units of an item without a serial number are interchangeable, so a change that
 * applies to only some of them splits the item: the original keeps the rest and
 * the given number of units becomes a new bulk item (same type, owner, project,
 * case, status and condition, unless overridden). History stays on both: the new
 * item links back via split_from_item_id and gets its own open project assignment.
 */
export async function splitBulkItem(
  tx: DbOrTx,
  ctx: Ctx,
  item: LockedItem,
  units: number,
  opts: { reason: string; correlationId?: string; caseId?: string | null } = { reason: "split" },
) {
  if (item.trackingMode !== "bulk") throw new DomainError("VALIDATION", `${item.label} is tracked individually and cannot be split.`);
  if (!Number.isInteger(units) || units < 1 || units >= item.quantity) {
    throw new DomainError("VALIDATION", `Choose between 1 and ${item.quantity - 1} units.`);
  }
  const rest = item.quantity - units;
  await tx.update(s.equipmentItem).set({ quantity: rest, version: sql`${s.equipmentItem.version} + 1` }).where(eq(s.equipmentItem.id, item.id));
  const [split] = await tx
    .insert(s.equipmentItem)
    .values({
      workspaceId: ctx.workspaceId,
      equipmentTypeId: item.equipmentTypeId,
      trackingMode: "bulk",
      quantity: units,
      rentalHouseId: item.rentalHouseId,
      projectId: item.projectId,
      caseId: opts.caseId === undefined ? item.caseId : opts.caseId,
      status: item.status,
      condition: item.condition,
      notes: item.notes,
      splitFromItemId: item.id,
    })
    .returning();
  if (item.projectId) {
    const [open] = await tx
      .select()
      .from(s.projectAssignment)
      .where(and(eq(s.projectAssignment.equipmentItemId, item.id), isNull(s.projectAssignment.endedAt)));
    if (open) await tx.update(s.projectAssignment).set({ quantity: rest }).where(eq(s.projectAssignment.id, open.id));
    await tx.insert(s.projectAssignment).values({
      workspaceId: ctx.workspaceId,
      equipmentItemId: split!.id,
      projectId: item.projectId,
      rentalHouseId: item.rentalHouseId,
      quantity: units,
      deliveryDocumentId: open?.deliveryDocumentId ?? null,
      assignedAt: open?.assignedAt ?? new Date(),
      assignedById: open?.assignedById ?? ctx.userId,
    });
  }
  await recordEvent(tx, ctx, {
    action: "equipment_item.split",
    entityType: "equipment_item",
    entityId: item.id,
    equipmentItemId: item.id,
    projectId: item.projectId,
    caseId: item.caseId,
    summary: `${item.typeName}: ${units} of ${item.quantity} split off (${opts.reason})`,
    changes: { quantity: { from: item.quantity, to: rest } },
    metadata: { splitItemId: split!.id },
    correlationId: opts.correlationId ?? null,
  });
  await recordEvent(tx, ctx, {
    action: "equipment_item.split",
    entityType: "equipment_item",
    entityId: split!.id,
    equipmentItemId: split!.id,
    projectId: item.projectId,
    caseId: split!.caseId,
    summary: `${item.typeName} × ${units} split off from ${item.quantity} units (${opts.reason})`,
    metadata: { splitFromItemId: item.id },
    correlationId: opts.correlationId ?? null,
  });
  return {
    ...split!,
    typeName: item.typeName,
    label: units > 1 ? `${item.typeName} × ${units}` : item.typeName,
  } satisfies LockedItem;
}
