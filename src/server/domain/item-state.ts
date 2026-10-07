import { z } from "zod";
import type { DbOrTx } from "../db/client";
import { packItem, unpackItem } from "./cases";
import { DomainError, requireRole, type Ctx } from "./context";
import { changeCondition, changeStatus, EQUIPMENT_CONDITIONS, lockItem, ON_PROJECT_STATUSES } from "./equipment-items";
import { splitBulkItem } from "./item-split";
import { optionalText } from "./validation";

const blankToUndefined = (v: unknown) => (v === "" || v == null ? undefined : v);

export const itemStateInput = z.object({
  status: z.preprocess(blankToUndefined, z.enum(ON_PROJECT_STATUSES).optional()),
  condition: z.preprocess(blankToUndefined, z.enum(EQUIPMENT_CONDITIONS).optional()),
  /** "" = not in a case; absent = leave as it is. */
  caseId: z.union([z.uuid(), z.literal("")]).optional(),
  /** Bulk items: apply to this many units only (they become their own entry). */
  units: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).optional()),
  note: optionalText(1000),
  expectedVersion: z.coerce.number().int().optional(),
});

/**
 * One save for the item page: status, condition and case together. For some
 * units of a bulk item the units are split off once and every change goes to them.
 */
export async function updateItemState(db: DbOrTx, ctx: Ctx, id: string, input: z.input<typeof itemStateInput>) {
  requireRole(ctx, "member");
  const data = itemStateInput.parse(input);
  return db.transaction(async (tx) => {
    const prev = await lockItem(tx, ctx, id);
    if (data.expectedVersion !== undefined && data.expectedVersion !== prev.version) {
      throw new DomainError("CONFLICT", "This item was changed by someone else in the meantime. Reload and try again.");
    }
    const status = data.status && prev.projectId && data.status !== prev.status ? data.status : null;
    const condition = data.condition && data.condition !== prev.condition ? data.condition : null;
    const caseId = data.caseId !== undefined && (data.caseId || null) !== prev.caseId ? data.caseId || null : undefined;
    const changed = [status && "status", condition && "condition", caseId !== undefined && "case"].filter(Boolean) as string[];
    if (changed.length === 0) return { item: prev, changed, split: false };

    const some = data.units !== undefined && data.units < prev.quantity;
    if (some && prev.trackingMode !== "bulk") throw new DomainError("VALIDATION", `${prev.label} is tracked individually.`);
    const target = some ? await splitBulkItem(tx, ctx, prev, data.units!, { reason: changed.join(", ") }) : prev;

    if (condition) await changeCondition(tx, ctx, target.id, { condition, note: data.note });
    if (status) await changeStatus(tx, ctx, target.id, { status, note: data.note });
    if (caseId !== undefined) {
      if (caseId) await packItem(tx, ctx, caseId, target.id, { allowMove: true });
      else await unpackItem(tx, ctx, target.id);
    }
    return { item: target, changed, split: some };
  });
}
