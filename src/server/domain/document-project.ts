/**
 * Which project a delivery / return note belongs to, from what is printed on it:
 * the rental house's project number, the production title and the AI's pick
 * from our project list. Only a clear single match is used; anything else is
 * left to the reviewer (who can also create the project from the document).
 */
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import type { Extraction } from "../ai/types";

export interface ProjectHints {
  title: string | null;
  number: string | null;
  customer: string | null;
  aiMatch: string | null;
  startDate: string | null;
  endDate: string | null;
}

export interface ProjectMatch {
  id: string;
  name: string;
  how: string;
}

const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);
const isoDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
const compact = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Project-related fields of a stored extraction (older extractions lack some of them). */
export function projectHints(ex: Partial<Extraction> | null | undefined): ProjectHints | null {
  if (!ex) return null;
  const hints = {
    title: clean(ex.project_reference),
    number: clean(ex.project_number),
    customer: clean(ex.customer_name),
    aiMatch: clean(ex.project_match),
    startDate: isoDate(ex.rental_start_date),
    endDate: isoDate(ex.rental_end_date),
  };
  if (hints.startDate && hints.endDate && hints.endDate < hints.startDate) hints.endDate = null;
  return hints.title || hints.number || hints.aiMatch ? hints : null;
}

const openProject = (ws: string) => and(eq(s.project.workspaceId, ws), isNull(s.project.archivedAt), ne(s.project.status, "closed"));

export async function findProjectForDocument(db: DbOrTx, ws: string, hints: ProjectHints, rentalHouseId: string | null): Promise<ProjectMatch | null> {
  // 1. The rental house's project number, saved on the project when an earlier note was confirmed.
  if (hints.number && compact(hints.number).length >= 3) {
    const rows = await db
      .selectDistinct({ id: s.project.id, name: s.project.name, rentalHouseId: s.projectRentalHouse.rentalHouseId })
      .from(s.projectRentalHouse)
      .innerJoin(s.project, eq(s.project.id, s.projectRentalHouse.projectId))
      .where(and(openProject(ws), sql`upper(regexp_replace(${s.projectRentalHouse.orderReference}, '[^A-Za-z0-9]', '', 'g')) = ${compact(hints.number)}`));
    const sameHouse = rentalHouseId ? rows.filter((r) => r.rentalHouseId === rentalHouseId) : [];
    const pick = sameHouse.length ? sameHouse : rows;
    const ids = new Set(pick.map((r) => r.id));
    if (ids.size === 1) return { id: pick[0]!.id, name: pick[0]!.name, how: `project number ${hints.number}` };
  }

  // 2. Exact name or code: the AI's pick from our list, or the printed title.
  for (const [candidate, how] of [
    [hints.aiMatch, "recognised by AI"],
    [hints.title, "same production title"],
  ] as const) {
    if (!candidate) continue;
    const rows = await db
      .select({ id: s.project.id, name: s.project.name })
      .from(s.project)
      .where(and(openProject(ws), sql`(search_normalize(${s.project.name}) = search_normalize(${candidate}) OR upper(${s.project.code}) = upper(${candidate}))`))
      .limit(2);
    if (rows.length === 1) return { ...rows[0]!, how };
  }

  // 3. Similar title ("Das verrückte Labyrinth -|- KAMERA: Stamm" vs. "Das verrückte Labyrinth").
  if (hints.title) {
    const rows = await db.execute<{ id: string; name: string; score: number }>(sql`
      SELECT id, name, greatest(
        similarity(search_normalize(name), search_normalize(${hints.title})),
        word_similarity(search_normalize(name), search_normalize(${hints.title}))
      ) AS score
      FROM project
      WHERE workspace_id = ${ws} AND archived_at IS NULL AND status <> 'closed'
      ORDER BY score DESC
      LIMIT 2`);
    const [best, second] = rows;
    if (best && Number(best.score) >= 0.6 && (!second || Number(best.score) - Number(second.score) >= 0.15)) {
      return { id: best.id, name: best.name, how: "similar production title" };
    }
  }
  return null;
}

/** Context line for the AI: "name; code; production company" of every open project. */
export async function projectContext(db: DbOrTx, ws: string) {
  const rows = await db
    .select({ name: s.project.name, code: s.project.code, company: s.project.productionCompany })
    .from(s.project)
    .where(openProject(ws))
    .orderBy(s.project.name)
    .limit(500);
  return rows.map((r) => [r.name, r.code, r.company].filter(Boolean).join("; "));
}
