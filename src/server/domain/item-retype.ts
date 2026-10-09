/**
 * Correct the equipment type of items after the fact (e.g. the wrong type was
 * picked while importing a delivery note). The items stay the same physical
 * objects with their history; the note's spelling moves from the wrong type to
 * the right one so the next import gets it right.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import { recordEvent } from "./audit";
import { DomainError, notFound, pgErrorOf, requireRole, type Ctx } from "./context";
import { learnAlias } from "./documents";
import { lockItem } from "./equipment-items";

const compactText = (v: string) => v.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

export async function changeItemType(db: DbOrTx, ctx: Ctx, itemIds: string[], typeId: string, opts: { documentLineId?: string } = {}) {
  requireRole(ctx, "member");
  const ids = [...new Set(itemIds)];
  if (ids.length === 0) throw new DomainError("VALIDATION", "No equipment to change.");
  return db.transaction(async (tx) => {
    const [type] = await tx
      .select()
      .from(s.equipmentType)
      .where(and(eq(s.equipmentType.id, typeId), eq(s.equipmentType.workspaceId, ctx.workspaceId), isNull(s.equipmentType.archivedAt)));
    if (!type) notFound("Equipment type");
    const oldTypes = new Set<string>();
    let changed = 0;
    for (const id of ids) {
      const item = await lockItem(tx, ctx, id);
      if (item.equipmentTypeId === typeId) continue;
      oldTypes.add(item.equipmentTypeId);
      try {
        await tx.update(s.equipmentItem).set({ equipmentTypeId: typeId, version: item.version + 1 }).where(eq(s.equipmentItem.id, id));
      } catch (err) {
        if (pgErrorOf(err)?.code === "23505") throw new DomainError("CONFLICT", `There is already a ${type.name} with serial number ${item.serialNumber}.`);
        throw err;
      }
      await recordEvent(tx, ctx, {
        action: "equipment_item.updated",
        entityType: "equipment_item",
        entityId: id,
        equipmentItemId: id,
        projectId: item.projectId,
        caseId: item.caseId,
        summary: `${item.label}: type ${item.typeName} → ${type.name}`,
        changes: { equipmentTypeId: { from: item.equipmentTypeId, to: typeId } },
      });
      changed++;
    }
    if (changed === 0) return { changed, typeName: type.name };

    // The note lines these items came from now point at the right type; their spelling moves along.
    const lines = await tx
      .select()
      .from(s.documentLine)
      .where(
        and(
          eq(s.documentLine.workspaceId, ctx.workspaceId),
          opts.documentLineId ? eq(s.documentLine.id, opts.documentLineId) : inArray(s.documentLine.matchedEquipmentItemId, ids),
        ),
      );
    for (const line of lines) {
      const wrong = line.matchedEquipmentTypeId;
      if (wrong && wrong !== typeId && oldTypes.has(wrong)) {
        const [old] = await tx.select().from(s.equipmentType).where(eq(s.equipmentType.id, wrong)).for("update");
        const spelling = compactText(line.description);
        const keep = old!.aliases.filter((a) => compactText(a) !== spelling);
        if (keep.length !== old!.aliases.length) {
          await tx.update(s.equipmentType).set({ aliases: keep }).where(eq(s.equipmentType.id, wrong));
          await recordEvent(tx, ctx, {
            action: "equipment_type.updated",
            entityType: "equipment_type",
            entityId: wrong,
            documentId: line.documentId,
            summary: `${old!.name}: “${line.description}” forgotten (it was ${type.name})`,
            changes: { aliases: { from: old!.aliases, to: keep } },
          });
        }
      }
      await tx.update(s.documentLine).set({ matchedEquipmentTypeId: typeId }).where(eq(s.documentLine.id, line.id));
      await learnAlias(tx, ctx, typeId, line, line.documentId);
    }
    return { changed, typeName: type.name };
  });
}
