/**
 * Calendar: everything with a date, for the calendar page, the subscription
 * (ICS) and the daily reminder. Read-only; built from projects, return dates,
 * documents and planned extra equipment.
 */
import { and, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import { listNeeds } from "./planned-needs";
import { addDays, listDueItems } from "./return-dates";

type Base = { date: string; projectId: string; projectName: string };
export type CalEvent =
  | (Base & { kind: "due"; key: string; overdue: boolean; house: string | null; units: number; items: { id: string; label: string }[] })
  | (Base & { kind: "project_start" | "project_end" })
  | (Base & { kind: "delivery" | "return_note"; documentId: string; number: string | null; house: string | null })
  | (Base & { kind: "need"; needId: string; until: string; label: string; quantity: number; house: string | null })
  | (Base & { kind: "order"; needId: string; needFrom: string; label: string; quantity: number; house: string | null });

/** Order within a day: what needs action first. */
const RANK: Record<CalEvent["kind"], number> = { due: 0, order: 1, need: 2, delivery: 3, return_note: 4, project_start: 5, project_end: 6 };

export async function calendarEvents(
  db: DbOrTx,
  workspaceId: string,
  opts: { from: string; to: string; today: string; projectId?: string | null; withOverdue?: boolean },
): Promise<CalEvent[]> {
  const ctx = { workspaceId };
  const projectWhere: SQL[] = [eq(s.project.workspaceId, workspaceId), isNull(s.project.archivedAt), sql`${s.project.status} <> 'closed'`];
  if (opts.projectId) projectWhere.push(eq(s.project.id, opts.projectId));
  const projects = await db.select({ id: s.project.id, name: s.project.name, startDate: s.project.startDate, endDate: s.project.endDate }).from(s.project).where(and(...projectWhere));
  const ids = projects.map((p) => p.id);
  if (ids.length === 0) return [];
  const names = new Map(projects.map((p) => [p.id, p.name]));

  const [due, overdue, docs, needs] = await Promise.all([
    listDueItems(db, ctx, { projectIds: ids, from: opts.from, until: opts.to }),
    opts.withOverdue === false ? Promise.resolve([]) : listDueItems(db, ctx, { projectIds: ids, until: addDays(opts.today, -1) }),
    db
      .select({ id: s.document.id, kind: s.document.kind, number: s.document.documentNumber, date: s.document.documentDate, projectId: s.document.projectId, house: s.rentalHouse.name })
      .from(s.document)
      .leftJoin(s.rentalHouse, eq(s.rentalHouse.id, s.document.rentalHouseId))
      .where(
        and(
          eq(s.document.workspaceId, workspaceId),
          eq(s.document.status, "confirmed"),
          inArray(s.document.kind, ["delivery_note", "return_note"]),
          inArray(s.document.projectId, ids),
          gte(s.document.documentDate, opts.from),
          lte(s.document.documentDate, opts.to),
        ),
      ),
    listNeeds(db, ctx, { projectIds: ids, status: ["open"], from: opts.from, until: opts.to }),
  ]);

  const events: CalEvent[] = [];
  // Return dates: one entry per day, project and rental house.
  const groups = new Map<string, Extract<CalEvent, { kind: "due" }>>();
  const seen = new Set<string>();
  for (const i of [...overdue, ...due]) {
    if (!i.due || seen.has(i.id)) continue;
    seen.add(i.id);
    const key = `${i.due}|${i.projectId}|${i.rentalHouseId ?? ""}`;
    const g = groups.get(key) ?? { kind: "due" as const, key, date: i.due, projectId: i.projectId, projectName: i.projectName, overdue: i.due < opts.today, house: i.rentalHouseName, units: 0, items: [] };
    g.units += i.units;
    g.items.push({ id: i.id, label: i.label });
    groups.set(key, g);
  }
  events.push(...groups.values());

  for (const p of projects) {
    if (p.startDate && p.startDate >= opts.from && p.startDate <= opts.to) events.push({ kind: "project_start", date: p.startDate, projectId: p.id, projectName: p.name });
    if (p.endDate && p.endDate >= opts.from && p.endDate <= opts.to) events.push({ kind: "project_end", date: p.endDate, projectId: p.id, projectName: p.name });
  }
  for (const d of docs) {
    events.push({ kind: d.kind === "return_note" ? "return_note" : "delivery", date: d.date!, documentId: d.id, number: d.number, house: d.house, projectId: d.projectId!, projectName: names.get(d.projectId!) ?? "" });
  }
  for (const n of needs) {
    const base = { needId: n.id, label: n.label, quantity: n.quantity, house: n.rentalHouseName, projectId: n.projectId, projectName: n.projectName };
    if (n.needUntil >= opts.from && n.needFrom <= opts.to) events.push({ kind: "need", date: n.needFrom, until: n.needUntil, ...base });
    if (n.orderBy && n.orderBy >= opts.from && n.orderBy <= opts.to) events.push({ kind: "order", date: n.orderBy, needFrom: n.needFrom, ...base });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || RANK[a.kind] - RANK[b.kind] || a.projectName.localeCompare(b.projectName));
}

/** Calendar page / subscription scope: the user's workspaces. */
export async function workspacesOf(db: DbOrTx, userId: string) {
  return db.select({ id: s.workspaceMember.workspaceId }).from(s.workspaceMember).where(eq(s.workspaceMember.userId, userId));
}
