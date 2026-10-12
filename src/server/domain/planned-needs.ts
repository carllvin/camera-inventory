/**
 * Planned extra equipment ("2 × Sandsack, 14.–16.11."): a plan, not equipment.
 * It reminds to order in time and shows in the calendar; the delivery note that
 * brings it fulfils it on confirmation, and the pieces get the plan's end date
 * as their return date. Nothing is merged or assigned silently: the review page
 * shows which plan a delivery fulfils before it is confirmed.
 */
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import { recordEvent } from "./audit";
import { DomainError, notFound, requireRole, type Ctx } from "./context";
import { addDays } from "./return-dates";
import { optionalText, optionalUuid } from "./validation";

const isoDate = z.iso.date();

export const needInput = z
  .object({
    equipmentTypeId: optionalUuid,
    label: optionalText(200),
    quantity: z.coerce.number().int().min(1).max(999).default(1),
    rentalHouseId: optionalUuid,
    needFrom: isoDate,
    needUntil: isoDate,
    orderBy: z.preprocess((v) => (v === "" ? null : v), isoDate.nullable().optional()),
    notes: optionalText(2000),
  })
  .refine((v) => v.needUntil >= v.needFrom, { path: ["needUntil"], message: "The end must not be before the start." })
  .refine((v) => v.equipmentTypeId || v.label, { path: ["label"], message: "Choose a type or describe what is needed." });

/** Remind this many days before the start when no order date is given. */
export const DEFAULT_ORDER_DAYS = 2;

async function typeName(tx: DbOrTx, ctx: Ctx, id: string) {
  const [t] = await tx.select({ name: s.equipmentType.name }).from(s.equipmentType).where(and(eq(s.equipmentType.id, id), eq(s.equipmentType.workspaceId, ctx.workspaceId)));
  if (!t) notFound("Equipment type");
  return t.name;
}

async function checkRefs(tx: DbOrTx, ctx: Ctx, data: z.infer<typeof needInput>) {
  if (data.rentalHouseId) {
    const [rh] = await tx.select({ id: s.rentalHouse.id }).from(s.rentalHouse).where(and(eq(s.rentalHouse.id, data.rentalHouseId), eq(s.rentalHouse.workspaceId, ctx.workspaceId)));
    if (!rh) notFound("Rental house");
  }
  return data.equipmentTypeId ? await typeName(tx, ctx, data.equipmentTypeId) : null;
}

const span = (n: { needFrom: string; needUntil: string }) => (n.needFrom === n.needUntil ? n.needFrom : `${n.needFrom} – ${n.needUntil}`);

export async function createNeed(db: DbOrTx, ctx: Ctx, projectId: string, input: unknown) {
  requireRole(ctx, "member");
  const data = needInput.parse(input);
  return db.transaction(async (tx) => {
    const [p] = await tx.select({ id: s.project.id }).from(s.project).where(and(eq(s.project.id, projectId), eq(s.project.workspaceId, ctx.workspaceId)));
    if (!p) notFound("Project");
    const tName = await checkRefs(tx, ctx, data);
    const label = data.label ?? tName!;
    const [need] = await tx
      .insert(s.plannedNeed)
      .values({
        workspaceId: ctx.workspaceId,
        projectId,
        equipmentTypeId: data.equipmentTypeId ?? null,
        label,
        quantity: data.quantity,
        rentalHouseId: data.rentalHouseId ?? null,
        needFrom: data.needFrom,
        needUntil: data.needUntil,
        orderBy: data.orderBy ?? addDays(data.needFrom, -DEFAULT_ORDER_DAYS),
        notes: data.notes ?? null,
        createdById: ctx.userId,
      })
      .returning();
    await recordEvent(tx, ctx, {
      action: "need.created",
      entityType: "planned_need",
      entityId: need!.id,
      projectId,
      rentalHouseId: need!.rentalHouseId,
      summary: `Planned: ${need!.quantity} × ${label} (${span(need!)})`,
    });
    return need!;
  });
}

async function lockNeed(tx: DbOrTx, ctx: Ctx, id: string) {
  const [n] = await tx.select().from(s.plannedNeed).where(and(eq(s.plannedNeed.id, id), eq(s.plannedNeed.workspaceId, ctx.workspaceId))).for("update");
  if (!n) notFound("Planned equipment");
  return n;
}

export async function updateNeed(db: DbOrTx, ctx: Ctx, id: string, input: unknown) {
  requireRole(ctx, "member");
  const data = needInput.parse(input);
  return db.transaction(async (tx) => {
    const n = await lockNeed(tx, ctx, id);
    if (n.status !== "open") throw new DomainError("VALIDATION", "Only open plans can be changed.");
    const tName = await checkRefs(tx, ctx, data);
    const next = {
      equipmentTypeId: data.equipmentTypeId ?? null,
      label: data.label ?? tName!,
      quantity: data.quantity,
      rentalHouseId: data.rentalHouseId ?? null,
      needFrom: data.needFrom,
      needUntil: data.needUntil,
      orderBy: data.orderBy ?? addDays(data.needFrom, -DEFAULT_ORDER_DAYS),
      notes: data.notes ?? null,
    };
    const changes = Object.fromEntries(
      Object.entries(next)
        .filter(([k, v]) => (n as Record<string, unknown>)[k] !== v)
        .map(([k, v]) => [k, { from: (n as Record<string, unknown>)[k], to: v }]),
    );
    if (Object.keys(changes).length === 0) return n;
    const [updated] = await tx.update(s.plannedNeed).set(next).where(eq(s.plannedNeed.id, id)).returning();
    await recordEvent(tx, ctx, {
      action: "need.updated",
      entityType: "planned_need",
      entityId: id,
      projectId: n.projectId,
      summary: `Plan changed: ${updated!.quantity} × ${updated!.label} (${span(updated!)})`,
      changes,
    });
    return updated!;
  });
}

async function setStatus(db: DbOrTx, ctx: Ctx, id: string, from: "open" | "cancelled", to: "open" | "cancelled") {
  requireRole(ctx, "member");
  return db.transaction(async (tx) => {
    const n = await lockNeed(tx, ctx, id);
    if (n.status !== from) throw new DomainError("CONFLICT", "This was changed again since. Undo the newer change first (newest first).");
    await tx.update(s.plannedNeed).set({ status: to }).where(eq(s.plannedNeed.id, id));
    await recordEvent(tx, ctx, {
      action: to === "cancelled" ? "need.cancelled" : "need.restored",
      entityType: "planned_need",
      entityId: id,
      projectId: n.projectId,
      summary: to === "cancelled" ? `Plan cancelled: ${n.quantity} × ${n.label} (${span(n)})` : `Plan restored: ${n.quantity} × ${n.label} (${span(n)})`,
      changes: { status: { from, to } },
    });
  });
}

export const cancelNeed = (db: DbOrTx, ctx: Ctx, id: string) => setStatus(db, ctx, id, "open", "cancelled");
export const restoreNeed = (db: DbOrTx, ctx: Ctx, id: string) => setStatus(db, ctx, id, "cancelled", "open");

export async function listNeeds(
  db: DbOrTx,
  ctx: Pick<Ctx, "workspaceId">,
  opts: { projectId?: string; projectIds?: string[]; status?: ("open" | "fulfilled" | "cancelled")[]; from?: string; until?: string } = {},
) {
  const where: SQL[] = [eq(s.plannedNeed.workspaceId, ctx.workspaceId), sql`${s.project.archivedAt} is null`];
  if (opts.projectId) where.push(eq(s.plannedNeed.projectId, opts.projectId));
  if (opts.projectIds) where.push(opts.projectIds.length ? inArray(s.plannedNeed.projectId, opts.projectIds) : sql`false`);
  if (opts.status) where.push(inArray(s.plannedNeed.status, opts.status));
  // Overlapping the window: anything that touches [from, until], also its order date.
  if (opts.until) where.push(sql`least(${s.plannedNeed.needFrom}, coalesce(${s.plannedNeed.orderBy}, ${s.plannedNeed.needFrom})) <= ${opts.until}`);
  if (opts.from) where.push(sql`${s.plannedNeed.needUntil} >= ${opts.from}`);
  return db
    .select({
      id: s.plannedNeed.id,
      projectId: s.plannedNeed.projectId,
      projectName: s.project.name,
      equipmentTypeId: s.plannedNeed.equipmentTypeId,
      typeName: s.equipmentType.name,
      label: s.plannedNeed.label,
      quantity: s.plannedNeed.quantity,
      rentalHouseId: s.plannedNeed.rentalHouseId,
      rentalHouseName: s.rentalHouse.name,
      needFrom: s.plannedNeed.needFrom,
      needUntil: s.plannedNeed.needUntil,
      orderBy: s.plannedNeed.orderBy,
      notes: s.plannedNeed.notes,
      status: s.plannedNeed.status,
      fulfilledDocumentId: s.plannedNeed.fulfilledDocumentId,
    })
    .from(s.plannedNeed)
    .innerJoin(s.project, eq(s.project.id, s.plannedNeed.projectId))
    .leftJoin(s.equipmentType, eq(s.equipmentType.id, s.plannedNeed.equipmentTypeId))
    .leftJoin(s.rentalHouse, eq(s.rentalHouse.id, s.plannedNeed.rentalHouseId))
    .where(and(...where))
    .orderBy(asc(s.plannedNeed.needFrom), asc(s.plannedNeed.label));
}
export type PlannedNeed = Awaited<ReturnType<typeof listNeeds>>[number];

// ---------------------------------------------------------------------------
// Fulfilment by a delivery
// ---------------------------------------------------------------------------

type Need = typeof s.plannedNeed.$inferSelect;
type Piece = { id: string; typeId: string; units: number };

/**
 * Which open plans a delivery fulfils: same project, same type, the rental house
 * fits (or the plan names none), and it arrives before the plan ends and at most
 * two weeks early. Plans are served in order of their start; pieces are used once.
 */
export function allocate(needs: Need[], pieces: Piece[], doc: { rentalHouseId: string | null; date: string }) {
  const left = [...pieces];
  const out: { need: Need; pieces: Piece[]; units: number }[] = [];
  for (const n of [...needs].sort((a, b) => a.needFrom.localeCompare(b.needFrom))) {
    if (n.status !== "open" || !n.equipmentTypeId) continue;
    if (n.rentalHouseId && doc.rentalHouseId && n.rentalHouseId !== doc.rentalHouseId) continue;
    if (doc.date > n.needUntil || doc.date < addDays(n.needFrom, -14)) continue;
    const taken: Piece[] = [];
    let units = 0;
    for (let i = 0; i < left.length && units < n.quantity; ) {
      if (left[i]!.typeId === n.equipmentTypeId) {
        units += left[i]!.units;
        taken.push(...left.splice(i, 1));
      } else i++;
    }
    if (taken.length) out.push({ need: n, pieces: taken, units });
  }
  return out;
}

async function openNeedsFor(tx: DbOrTx, ctx: Ctx, projectId: string) {
  return tx.select().from(s.plannedNeed).where(and(eq(s.plannedNeed.workspaceId, ctx.workspaceId), eq(s.plannedNeed.projectId, projectId), eq(s.plannedNeed.status, "open")));
}

/** Review page: the plans this note would fulfil when confirmed (from its lines). */
export async function previewNeedsForDocument(db: DbOrTx, ctx: Ctx, doc: typeof s.document.$inferSelect, today: string) {
  if (doc.kind !== "delivery_note" || !doc.projectId || doc.status === "confirmed") return [];
  const needs = await openNeedsFor(db, ctx, doc.projectId);
  if (needs.length === 0) return [];
  const lines = await db
    .select({ id: s.documentLine.id, typeId: s.documentLine.matchedEquipmentTypeId, quantity: s.documentLine.quantity, resolution: s.documentLine.resolution })
    .from(s.documentLine)
    .where(eq(s.documentLine.documentId, doc.id));
  const pieces = lines.filter((l) => l.typeId && l.resolution !== "ignore" && l.resolution !== "create_set").map((l) => ({ id: l.id, typeId: l.typeId!, units: l.quantity }));
  return allocate(needs, pieces, { rentalHouseId: doc.rentalHouseId, date: doc.documentDate ?? today }).map((a) => ({
    id: a.need.id,
    label: a.need.label,
    quantity: a.need.quantity,
    units: Math.min(a.units, a.need.quantity),
    needFrom: a.need.needFrom,
    needUntil: a.need.needUntil,
  }));
}

/**
 * On confirming a delivery: mark the plans it brings as fulfilled and give
 * those pieces the plan's end as their return date (unless they have one).
 */
export async function fulfilNeeds(tx: DbOrTx, ctx: Ctx, doc: typeof s.document.$inferSelect, itemIds: string[], today: string, correlationId: string) {
  if (!doc.projectId || itemIds.length === 0) return [];
  const needs = await openNeedsFor(tx, ctx, doc.projectId);
  if (needs.length === 0) return [];
  const items = await tx
    .select({ id: s.equipmentItem.id, typeId: s.equipmentItem.equipmentTypeId, quantity: s.equipmentItem.quantity, returnDue: s.equipmentItem.returnDue })
    .from(s.equipmentItem)
    .where(inArray(s.equipmentItem.id, itemIds));
  const own = new Map(items.map((i) => [i.id, i.returnDue]));
  const done = allocate(needs, items.map((i) => ({ id: i.id, typeId: i.typeId, units: i.quantity })), { rentalHouseId: doc.rentalHouseId, date: doc.documentDate ?? today });
  for (const a of done) {
    await tx.update(s.plannedNeed).set({ status: "fulfilled", fulfilledDocumentId: doc.id }).where(eq(s.plannedNeed.id, a.need.id));
    const dated = a.pieces.filter((p) => !own.get(p.id)).map((p) => p.id);
    if (dated.length) await tx.update(s.equipmentItem).set({ returnDue: a.need.needUntil }).where(inArray(s.equipmentItem.id, dated));
    await recordEvent(tx, ctx, {
      action: "need.fulfilled",
      entityType: "planned_need",
      entityId: a.need.id,
      projectId: doc.projectId,
      documentId: doc.id,
      rentalHouseId: doc.rentalHouseId,
      summary: `Plan fulfilled by delivery ${doc.documentNumber ?? ""}: ${Math.min(a.units, a.need.quantity)} × ${a.need.label}, return by ${a.need.needUntil}`.replace("  ", " "),
      changes: { status: { from: "open", to: "fulfilled" } },
      metadata: { items: a.pieces.map((p) => p.id) },
      correlationId,
    });
  }
  return done;
}
