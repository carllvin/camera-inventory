/**
 * Current lists (Mietliste / Bestandsliste): the rental house's list of everything
 * the production has right now, compared with the database. Items with a serial or
 * asset number are compared one by one, everything else by type and count. The
 * differences are fixed one click at a time (or all at once) through the normal
 * services: adding uses the delivery logic, removing the soft removal.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import { recordEvent } from "./audit";
import { DomainError, notFound, requireRole, type Ctx } from "./context";
import { receiveDeliveryLine } from "./documents";
import { itemLabel } from "./equipment-items";
import { removeEquipment } from "./project-removal";
import { loadProjectItems } from "./return-matching";

export interface ListPresent { lineId: string; label: string; units: number }
export interface ListMissing { lineId: string; label: string; units: number; canAdd: boolean; reason: string | null }
export interface ListExtra { itemId: string; label: string; units: number; bulk: boolean }

export async function getConsolidation(db: DbOrTx, ctx: Ctx, documentId: string) {
  const [doc] = await db.select().from(s.document).where(and(eq(s.document.id, documentId), eq(s.document.workspaceId, ctx.workspaceId)));
  if (!doc) notFound("Document");
  if (doc.kind !== "inventory_list") throw new DomainError("VALIDATION", "Only current lists are compared with the database.");
  if (!doc.projectId) return { doc, present: [] as ListPresent[], missing: [] as ListMissing[], extra: [] as ListExtra[] };

  const lines = (
    await db
      .select({ line: s.documentLine, typeName: s.equipmentType.name })
      .from(s.documentLine)
      .leftJoin(s.equipmentType, eq(s.equipmentType.id, s.documentLine.matchedEquipmentTypeId))
      .where(eq(s.documentLine.documentId, documentId))
      .orderBy(asc(s.documentLine.lineNumber))
  ).filter((r) => r.line.resolution !== "ignore");
  // Only what this rental house supplies is expected on its list.
  const items = (await loadProjectItems(db, ctx.workspaceId, doc.projectId)).filter((i) => !doc.rentalHouseId || i.rentalHouseId === doc.rentalHouseId);
  const byId = new Map(items.map((i) => [i.id, i]));
  const claimed = new Map<string, number>();
  const left = (id: string) => (byId.get(id)?.quantity ?? 0) - (claimed.get(id) ?? 0);

  const present: ListPresent[] = [];
  const missing: ListMissing[] = [];
  const name = (r: (typeof lines)[number]) => r.typeName ?? r.line.description;

  // 1. Lines that name a specific item (serial / asset) on the project.
  const rest: typeof lines = [];
  for (const r of lines) {
    const id = r.line.matchedEquipmentItemId;
    if (id && byId.has(id) && left(id) > 0) {
      const units = Math.min(left(id), byId.get(id)!.quantity);
      claimed.set(id, (claimed.get(id) ?? 0) + units);
      present.push({ lineId: r.line.id, label: itemLabel(byId.get(id)!), units });
    } else rest.push(r);
  }
  // 2. Lines without identifiers: count against the project's items of that type.
  for (const r of rest) {
    const l = r.line;
    const identified = Boolean(l.serialNumber || l.assetNumber);
    if (!identified && l.matchedEquipmentTypeId && l.resolution === "create_new") {
      let need = l.quantity;
      for (const i of items) {
        if (need <= 0) break;
        if (i.equipmentTypeId !== l.matchedEquipmentTypeId || left(i.id) <= 0) continue;
        const take = Math.min(need, left(i.id));
        claimed.set(i.id, (claimed.get(i.id) ?? 0) + take);
        need -= take;
      }
      const found = l.quantity - need;
      if (found > 0) present.push({ lineId: l.id, label: `${name(r)}${found > 1 ? ` × ${found}` : ""}`, units: found });
      if (need > 0) missing.push({ lineId: l.id, label: `${name(r)}${need > 1 ? ` × ${need}` : ""}`, units: need, canAdd: true, reason: null });
      continue;
    }
    const label = `${name(r)}${l.serialNumber ? ` (SN ${l.serialNumber})` : l.assetNumber ? ` (Asset ${l.assetNumber})` : l.quantity > 1 ? ` × ${l.quantity}` : ""}`;
    const canAdd = l.resolution === "create_new" || l.resolution === "match_existing";
    missing.push({
      lineId: l.id,
      label,
      units: l.quantity,
      canAdd,
      reason: canAdd ? null : l.resolution === "pending" ? "choose the equipment type first" : l.matchReason,
    });
  }
  // 3. On the project (from this rental house) but not on the list.
  const extra: ListExtra[] = items
    .filter((i) => left(i.id) > 0)
    .map((i) => ({ itemId: i.id, label: left(i.id) < i.quantity ? `${i.typeName} × ${left(i.id)} (of ${i.quantity})` : itemLabel(i), units: left(i.id), bulk: i.trackingMode === "bulk" }));
  return { doc, present, missing, extra };
}

async function projectFor(tx: DbOrTx, doc: typeof s.document.$inferSelect) {
  if (doc.status === "confirmed" || doc.status === "discarded") throw new DomainError("VALIDATION", "This list is closed.");
  if (!doc.projectId) throw new DomainError("VALIDATION", "Choose the project first.");
  if (!doc.rentalHouseId) throw new DomainError("VALIDATION", "Choose the rental house first.");
  const [project] = await tx.select().from(s.project).where(eq(s.project.id, doc.projectId));
  if (!project || project.status === "closed") throw new DomainError("VALIDATION", "The project is closed.");
  return project;
}

/** Add what the list has and the database lacks: one line, or every addable line. */
export async function addFromList(db: DbOrTx, ctx: Ctx, documentId: string, lineId: string | "all") {
  requireRole(ctx, "member");
  const { doc, missing } = await getConsolidation(db, ctx, documentId);
  const todo = missing.filter((m) => m.canAdd && (lineId === "all" || m.lineId === lineId));
  if (todo.length === 0) throw new DomainError("VALIDATION", lineId === "all" ? "Nothing on the list can be added (check the open lines)." : "This line cannot be added. Reload the page.");
  return db.transaction(async (tx) => {
    const project = await projectFor(tx, doc);
    const r = { doc, project, rentalHouseId: doc.rentalHouseId!, now: new Date(), correlationId: randomUUID() };
    let added = 0;
    for (const m of todo) {
      const [line] = await tx.select().from(s.documentLine).where(eq(s.documentLine.id, m.lineId));
      added += await receiveDeliveryLine(tx, ctx, r, line!, m.units);
    }
    return added;
  });
}

/** Take off the project what is not on the list (recorded as returned, with the list as reason). */
export async function removeNotOnList(db: DbOrTx, ctx: Ctx, documentId: string, itemId: string | "all") {
  requireRole(ctx, "member");
  const { doc, extra } = await getConsolidation(db, ctx, documentId);
  const todo = extra.filter((x) => itemId === "all" || x.itemId === itemId);
  if (todo.length === 0) throw new DomainError("VALIDATION", "Nothing to remove. Reload the page.");
  await projectFor(db, doc);
  const r = await removeEquipment(
    db,
    ctx,
    { projectId: doc.projectId!, reason: "returned", note: `Not on current list ${doc.documentNumber ?? ""}`.trim() },
    { groups: todo.map((x) => ({ itemIds: [x.itemId], units: x.units })) },
  );
  return r.units;
}

/** Close the list: it stays as a record of the check. */
export async function finishList(db: DbOrTx, ctx: Ctx, documentId: string) {
  requireRole(ctx, "member");
  const c = await getConsolidation(db, ctx, documentId);
  return db.transaction(async (tx) => {
    await projectFor(tx, c.doc);
    const units = (xs: { units: number }[]) => xs.reduce((n, x) => n + x.units, 0);
    const [doc] = await tx.update(s.document).set({ status: "confirmed", confirmedAt: new Date(), confirmedById: ctx.userId }).where(eq(s.document.id, documentId)).returning();
    await recordEvent(tx, ctx, {
      action: "document.confirmed",
      entityType: "document",
      entityId: documentId,
      documentId,
      projectId: doc!.projectId,
      rentalHouseId: doc!.rentalHouseId,
      summary: `Current list ${doc!.documentNumber ?? ""} checked: ${units(c.present)} match${c.missing.length || c.extra.length ? `, ${units(c.missing)} only on the list, ${units(c.extra)} only in the database` : " — all consistent"}`.replace("  ", " "),
      metadata: { present: units(c.present), missing: units(c.missing), extra: units(c.extra) },
    });
    return doc!;
  });
}
