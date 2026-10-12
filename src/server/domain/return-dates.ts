/**
 * Return dates. Each rented piece has to go back on a date that comes from the
 * most specific place that sets one:
 *
 *   own date of the piece → its set → the delivery note it came with → the project's end
 *
 * Setting a date on a delivery or set moves everything below it that has no
 * date of its own; clearing a date makes it follow the next level again.
 * Every change is in the history and can be undone.
 */
import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import { recordEvent } from "./audit";
import { DomainError, notFound, requireRole, type Ctx } from "./context";
import { itemLabel } from "./equipment-items";

export type DueSource = "item" | "case" | "document" | "project";
export type DueTarget = { kind: "item" | "case" | "document"; id: string };

/** YYYY-MM-DD plus whole days (calendar arithmetic, no time zones involved). */
export function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); negative when `to` is earlier. */
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

const openAssignment = and(eq(s.projectAssignment.equipmentItemId, s.equipmentItem.id), isNull(s.projectAssignment.endedAt));

const dueExpr = sql<string | null>`coalesce(${s.equipmentItem.returnDue}, ${s.equipmentCase.returnDue}, ${s.document.returnDue}, ${s.project.endDate})`;
const sourceExpr = sql<DueSource | null>`case
  when ${s.equipmentItem.returnDue} is not null then 'item'
  when ${s.equipmentCase.returnDue} is not null then 'case'
  when ${s.document.returnDue} is not null then 'document'
  when ${s.project.endDate} is not null then 'project' end`;

/** Pieces on projects (not returned) with the date they have to go back. */
export async function listDueItems(
  db: DbOrTx,
  ctx: Pick<Ctx, "workspaceId">,
  opts: { projectId?: string; projectIds?: string[]; until?: string; from?: string; itemId?: string } = {},
) {
  const where: SQL[] = [eq(s.equipmentItem.workspaceId, ctx.workspaceId), sql`${s.equipmentItem.projectId} is not null`, isNull(s.project.archivedAt)];
  if (opts.projectId) where.push(eq(s.equipmentItem.projectId, opts.projectId));
  if (opts.projectIds) where.push(opts.projectIds.length ? sql`${s.equipmentItem.projectId} in ${opts.projectIds}` : sql`false`);
  if (opts.itemId) where.push(eq(s.equipmentItem.id, opts.itemId));
  if (opts.until) where.push(sql`${dueExpr} <= ${opts.until}`);
  if (opts.from) where.push(sql`${dueExpr} >= ${opts.from}`);
  const rows = await db
    .select({
      id: s.equipmentItem.id,
      projectId: s.project.id,
      projectName: s.project.name,
      typeName: s.equipmentType.name,
      serialNumber: s.equipmentItem.serialNumber,
      trackingMode: s.equipmentItem.trackingMode,
      quantity: s.equipmentItem.quantity,
      status: s.equipmentItem.status,
      rentalHouseId: s.equipmentItem.rentalHouseId,
      rentalHouseName: s.rentalHouse.name,
      caseId: s.equipmentCase.id,
      caseName: s.equipmentCase.name,
      documentId: s.document.id,
      documentNumber: s.document.documentNumber,
      own: s.equipmentItem.returnDue,
      due: dueExpr,
      source: sourceExpr,
    })
    .from(s.equipmentItem)
    .innerJoin(s.project, eq(s.project.id, s.equipmentItem.projectId))
    .innerJoin(s.equipmentType, eq(s.equipmentType.id, s.equipmentItem.equipmentTypeId))
    .leftJoin(s.rentalHouse, eq(s.rentalHouse.id, s.equipmentItem.rentalHouseId))
    .leftJoin(s.equipmentCase, eq(s.equipmentCase.id, s.equipmentItem.caseId))
    .leftJoin(s.projectAssignment, openAssignment)
    .leftJoin(s.document, eq(s.document.id, s.projectAssignment.deliveryDocumentId))
    .where(and(...where))
    .orderBy(sql`${dueExpr} asc nulls last`, asc(s.equipmentType.name));
  return rows.map((r) => ({ ...r, label: itemLabel(r), units: r.trackingMode === "bulk" ? r.quantity : 1 }));
}
export type DueItem = Awaited<ReturnType<typeof listDueItems>>[number];

/** The date one piece goes back, and where that date comes from. */
export async function itemReturnInfo(db: DbOrTx, ctx: Ctx, itemId: string) {
  const [row] = await listDueItems(db, ctx, { itemId });
  return row ?? null;
}

/** A set's or delivery's own date, or what it inherits (the project's end). */
export async function containerReturnInfo(db: DbOrTx, ctx: Ctx, target: { kind: "case" | "document"; id: string }) {
  const table = target.kind === "case" ? s.equipmentCase : s.document;
  const [row] = await db
    .select({ own: table.returnDue, projectId: table.projectId, projectEnd: s.project.endDate })
    .from(table)
    .leftJoin(s.project, eq(s.project.id, table.projectId))
    .where(and(eq(table.id, target.id), eq(table.workspaceId, ctx.workspaceId)));
  if (!row) return null;
  return { own: row.own, inherited: row.projectEnd, due: row.own ?? row.projectEnd };
}

/** Return dates per piece: overdue, due soon, later (open pieces only). */
export function bucketDue(items: DueItem[], today: string, soonDays: number) {
  const soonUntil = addDays(today, soonDays);
  const overdue = items.filter((i) => i.due && i.due < today);
  const soon = items.filter((i) => i.due && i.due >= today && i.due <= soonUntil);
  const undated = items.filter((i) => !i.due);
  const units = (l: DueItem[]) => l.reduce((n, i) => n + i.units, 0);
  return { overdue, soon, undated, overdueUnits: units(overdue), soonUnits: units(soon), undatedUnits: units(undated) };
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

const dateOrNull = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.iso.date().nullable());

async function loadTarget(tx: DbOrTx, ctx: Ctx, target: DueTarget) {
  if (target.kind === "item") {
    const [r] = await tx
      .select({ id: s.equipmentItem.id, own: s.equipmentItem.returnDue, projectId: s.equipmentItem.projectId, typeName: s.equipmentType.name, serialNumber: s.equipmentItem.serialNumber, trackingMode: s.equipmentItem.trackingMode, quantity: s.equipmentItem.quantity })
      .from(s.equipmentItem)
      .innerJoin(s.equipmentType, eq(s.equipmentType.id, s.equipmentItem.equipmentTypeId))
      .where(and(eq(s.equipmentItem.id, target.id), eq(s.equipmentItem.workspaceId, ctx.workspaceId)))
      .for("update", { of: s.equipmentItem });
    if (!r) notFound("Equipment");
    if (!r.projectId) throw new DomainError("VALIDATION", "Only equipment on a project has a return date.");
    const info = await itemReturnInfo(tx, ctx, r.id);
    return { own: r.own, effective: info?.due ?? null, label: itemLabel(r), projectId: r.projectId, audit: { entityType: "equipment_item" as const, equipmentItemId: r.id } };
  }
  if (target.kind === "case") {
    const [r] = await tx.select().from(s.equipmentCase).where(and(eq(s.equipmentCase.id, target.id), eq(s.equipmentCase.workspaceId, ctx.workspaceId))).for("update");
    if (!r) notFound("Set");
    const info = await containerReturnInfo(tx, ctx, { kind: "case", id: target.id });
    return { own: r.returnDue, effective: info?.due ?? null, label: `Set ${r.name}`, projectId: r.projectId, audit: { entityType: "case" as const, caseId: r.id } };
  }
  const [r] = await tx.select().from(s.document).where(and(eq(s.document.id, target.id), eq(s.document.workspaceId, ctx.workspaceId))).for("update");
  if (!r) notFound("Document");
  if (r.kind !== "delivery_note") throw new DomainError("VALIDATION", "Only delivery notes have a return date.");
  const info = await containerReturnInfo(tx, ctx, { kind: "document", id: target.id });
  return { own: r.returnDue, effective: info?.due ?? null, label: `Delivery ${r.documentNumber ?? ""}`.trim(), projectId: r.projectId, audit: { entityType: "document" as const, documentId: r.id } };
}

async function write(tx: DbOrTx, target: DueTarget, value: string | null) {
  const table = target.kind === "item" ? s.equipmentItem : target.kind === "case" ? s.equipmentCase : s.document;
  await tx.update(table).set({ returnDue: value }).where(eq(table.id, target.id));
}

/** Set (date) or clear (null: follow the set / delivery / project again) a return date. */
export async function setReturnDue(db: DbOrTx, ctx: Ctx, target: DueTarget, input: unknown, opts: { expectCurrent?: string | null } = {}) {
  requireRole(ctx, "member");
  const value = dateOrNull.parse(input);
  return db.transaction(async (tx) => {
    const t = await loadTarget(tx, ctx, target);
    if (opts.expectCurrent !== undefined && t.own !== opts.expectCurrent) {
      throw new DomainError("CONFLICT", "This was changed again since. Undo the newer change first (newest first).");
    }
    if (t.own === value) return t;
    await write(tx, target, value);
    await recordEvent(tx, ctx, {
      action: "return_due.changed",
      entityId: target.id,
      projectId: t.projectId,
      ...t.audit,
      summary: value ? `${t.label}: return by ${value}` : `${t.label}: own return date removed`,
      changes: { returnDue: { from: t.own, to: value } },
      metadata: { target: target.kind },
    });
    return { ...t, own: value };
  });
}

/** Move a return date by whole days (from the date it has now, own or inherited). */
export async function shiftReturnDue(db: DbOrTx, ctx: Ctx, target: DueTarget, days: number) {
  requireRole(ctx, "member");
  const n = z.number().int().min(-365).max(365).refine((v) => v !== 0, "Choose how many days.").parse(days);
  const base = await db.transaction(async (tx) => (await loadTarget(tx, ctx, target)).effective);
  if (!base) throw new DomainError("VALIDATION", "There is no return date to move yet. Set one first.");
  return setReturnDue(db, ctx, target, addDays(base, n));
}
