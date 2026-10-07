/**
 * Turns extracted document lines into reviewable proposals: which physical item
 * (by serial / asset number) or which equipment type (catalog match, aliases,
 * fuzzy name) each line refers to, and what confirming would do.
 *
 * Rules that protect the inventory:
 *  - a serial that already exists is always the existing item (never a second one);
 *  - an existing item that is on a project, or belongs to another rental house,
 *    becomes a discrepancy the user must resolve - nothing is merged or moved silently;
 *  - lines without a confident type stay "pending" until a person chooses one.
 */
import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import { isNoMaker } from "@/lib/type-name";
import type { ExtractedLine } from "../ai/types";
import { itemLabel } from "./equipment-items";

export type Resolution = "pending" | "match_existing" | "create_new" | "ignore" | "discrepancy" | "create_set";

/** One reviewable line before it is stored. */
export interface ProposedLine {
  rawText: string | null;
  description: string;
  manufacturer: string | null;
  model: string | null;
  quantity: number;
  serialNumber: string | null;
  assetNumber: string | null;
  aiConfidence: number | null;
  catalogMatch: string | null;
  isEquipment: boolean;
  /** AI help for creating a new type (category path, "serialized" / "bulk"). */
  suggestedCategory?: string | null;
  suggestedTracking?: string | null;
  /** Set / kit the line belongs to by the document's layout. */
  setName?: string | null;
  /** A transport case: becomes a set on delivery, is not equipment itself. */
  isContainer?: boolean;
}

/** "Koffer f. BLACKWING 4-fach", "Case", "Peli 1510", "Flightcase …": a transport case, by its wording. */
export function looksLikeCase(description: string) {
  return /(^|[^a-zäöü])(transport)?(koffer|case|cases|kiste|flightcase|flight case|peli|pelicase|hardcase|hard case|rollkoffer|trolley)([^a-zäöü]|$)/i.test(description);
}

export interface MatchResult {
  matchedEquipmentTypeId: string | null;
  matchedEquipmentItemId: string | null;
  matchConfidence: number | null;
  matchReason: string | null;
  resolution: Resolution;
}

export interface MatchContext {
  workspaceId: string;
  projectId: string | null;
  rentalHouseId: string | null;
  kind: "delivery_note" | "return_note" | "other" | "inventory_list";
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const clean = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

/**
 * Expand AI lines into one stored line per identifiable unit: "2 × Bolt TX, SN A, B"
 * becomes two lines with one serial each, so every physical item can be matched.
 */
export function expandExtractedLines(lines: ExtractedLine[]): ProposedLine[] {
  const out: ProposedLine[] = [];
  for (const l of lines) {
    const base = {
      rawText: clean(l.raw_text),
      description: clean(l.description) ?? clean(l.raw_text) ?? "(unreadable line)",
      manufacturer: clean(l.manufacturer),
      model: clean(l.model),
      aiConfidence: Number.isFinite(l.confidence) ? clamp01(l.confidence) : null,
      catalogMatch: clean(l.catalog_match),
      isEquipment: l.is_equipment,
      isContainer: l.is_container ?? looksLikeCase(clean(l.description) ?? l.raw_text),
      setName: clean(l.set_name ?? null),
      suggestedCategory: l.catalog_match ? null : clean(l.suggested_category ?? null),
      suggestedTracking: l.catalog_match || !["serialized", "bulk"].includes(l.suggested_tracking ?? "") ? null : l.suggested_tracking!,
    };
    const qty = Math.max(1, Math.round(l.quantity || 1));
    const serials = l.serial_numbers.map((x) => x.trim()).filter(Boolean);
    const assets = l.asset_numbers.map((x) => x.trim()).filter(Boolean);
    if (!l.is_equipment || base.isContainer) {
      out.push({ ...base, quantity: qty, serialNumber: base.isContainer ? (serials[0] ?? null) : null, assetNumber: base.isContainer ? (assets[0] ?? null) : null });
      continue;
    }
    const ids = serials.length >= assets.length ? serials : assets;
    if (ids.length <= 1) {
      out.push({ ...base, quantity: qty, serialNumber: serials[0] ?? null, assetNumber: assets[0] ?? null });
      continue;
    }
    // Several identifiers: one line per unit (pair serial[i] with asset[i] when both are listed).
    ids.forEach((_, i) => out.push({ ...base, quantity: 1, serialNumber: serials[i] ?? null, assetNumber: assets[i] ?? null }));
    if (qty > ids.length) out.push({ ...base, quantity: qty - ids.length, serialNumber: null, assetNumber: null });
  }
  return out;
}

interface ItemHit {
  id: string;
  equipmentTypeId: string;
  typeName: string;
  serialNumber: string | null;
  assetNumber: string | null;
  quantity: number;
  trackingMode: string;
  rentalHouseId: string | null;
  projectId: string | null;
  projectName: string | null;
  status: string;
}

async function findItems(db: DbOrTx, ws: string, where: ReturnType<typeof sql>) {
  return (await db
    .select({
      id: s.equipmentItem.id,
      equipmentTypeId: s.equipmentItem.equipmentTypeId,
      typeName: s.equipmentType.name,
      serialNumber: s.equipmentItem.serialNumber,
      assetNumber: s.equipmentItem.assetNumber,
      quantity: s.equipmentItem.quantity,
      trackingMode: s.equipmentItem.trackingMode,
      rentalHouseId: s.equipmentItem.rentalHouseId,
      projectId: s.equipmentItem.projectId,
      projectName: s.project.name,
      status: s.equipmentItem.status,
    })
    .from(s.equipmentItem)
    .innerJoin(s.equipmentType, eq(s.equipmentType.id, s.equipmentItem.equipmentTypeId))
    .leftJoin(s.project, eq(s.project.id, s.equipmentItem.projectId))
    .where(and(eq(s.equipmentItem.workspaceId, ws), where))
    .limit(10)) as ItemHit[];
}

/** Find the equipment type: exact catalog/alias name first, then fuzzy on description. */
export async function findType(db: DbOrTx, ws: string, line: Pick<ProposedLine, "catalogMatch" | "description" | "manufacturer" | "model">) {
  if (line.catalogMatch) {
    const [exact] = await db
      .select({ id: s.equipmentType.id, name: s.equipmentType.name })
      .from(s.equipmentType)
      .where(
        and(
          eq(s.equipmentType.workspaceId, ws),
          sql`(lower(${s.equipmentType.name}) = lower(${line.catalogMatch})
               OR lower(${line.catalogMatch}) = ANY (SELECT lower(a) FROM unnest(${s.equipmentType.aliases}) a)
               OR lower(${s.equipmentType.manufacturer} || ' ' || ${s.equipmentType.model}) = lower(${line.catalogMatch}))`,
        ),
      )
      .limit(1);
    if (exact) return { id: exact.id, name: exact.name, score: 0.95, how: "catalog match" };
  }
  const text = [line.manufacturer, line.model, line.description].filter(Boolean).join(" ");
  if (!text.trim()) return null;
  // Candidates: the most similar names, plus every type whose model number is written in the line
  // ("BEBOB V-Mount Akku 98Wh V98micro" names bebob V98micro even if another 98Wh battery reads closer).
  const rows = await db.execute<{ id: string; name: string; manufacturer: string; model: string; score: number; model_hit: boolean; maker_hit: boolean }>(sql`
    WITH t AS (SELECT search_normalize(${text}) AS norm, search_compact(${text}) AS comp)
    SELECT id, name, manufacturer, model,
      greatest(
        word_similarity(t.norm, search_text),
        word_similarity(search_normalize(${line.description}), search_text),
        similarity(t.norm, search_text)
      ) AS score,
      (length(search_compact(model)) >= 3 AND (
         (' ' || regexp_replace(t.norm, '[^a-z0-9]+', ' ', 'g') || ' ') LIKE ('% ' || btrim(regexp_replace(search_normalize(model), '[^a-z0-9]+', ' ', 'g')) || ' %')
         OR (length(search_compact(model)) >= 5 AND strpos(t.comp, search_compact(model)) > 0))) AS model_hit,
      (length(search_normalize(manufacturer)) >= 2 AND (' ' || regexp_replace(t.norm, '[^a-z0-9]+', ' ', 'g') || ' ') LIKE ('% ' || regexp_replace(search_normalize(manufacturer), '[^a-z0-9]+', ' ', 'g') || ' %')) AS maker_hit
    FROM equipment_type, t
    WHERE workspace_id = ${ws} AND archived_at IS NULL
      AND (search_text % t.norm OR word_similarity(t.norm, search_text) > 0.3
           OR (length(search_compact(model)) >= 3 AND strpos(t.comp, search_compact(model)) > 0))
    ORDER BY score DESC
    LIMIT 30`);
  let candidates = [...rows].map((r) => ({ ...r, score: Number(r.score) }));
  // A maker named in the line rules out other makers' products.
  if (candidates.some((c) => c.maker_hit)) candidates = candidates.filter((c) => c.maker_hit || isNoMaker(c.manufacturer));
  // The model number written in the line decides; the longest one wins ("VL-4S" over "VL").
  const byModel = candidates.filter((c) => c.model_hit).sort((a, b) => compact(b.model).length - compact(a.model).length || b.score - a.score);
  if (byModel.length > 0) {
    const [first, next] = byModel;
    if (!next || compact(next.model).length < compact(first!.model).length || first!.score - next.score >= 0.05) {
      return { id: first!.id, name: first!.name, score: clamp01(Math.max(first!.score, 0.8)), how: "model number in the text" };
    }
  }
  // A different model number on the line rules a type out ("C700" is not a "C70", "RX" not a "TX").
  const tokens = text.toUpperCase().split(/[^A-Z0-9]+/).filter((w) => /\d/.test(w));
  const conflicts = (model: string) => {
    const m = compact(model);
    return /\d/.test(m) && tokens.some((w) => w !== m && (w.startsWith(m) || m.startsWith(w)) && Math.min(w.length, m.length) >= 2);
  };
  candidates = candidates.filter((c) => !conflicts(c.model));
  const [best, second] = candidates.sort((a, b) => b.score - a.score);
  if (!best || best.score < 0.5) return null;
  // Ambiguous: two types almost equally similar (e.g. TX vs RX) - let a person choose.
  if (second && best.score - second.score < 0.05) return null;
  return { id: best.id, name: best.name, score: clamp01(best.score), how: "similar name" };
}

const compact = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Decide what a line refers to and what confirming it would do.
 * `forcedTypeId` is a type the reviewer picked by hand (always wins over AI/fuzzy).
 */
export async function matchLine(db: DbOrTx, ctx: MatchContext, line: ProposedLine, opts: { forcedTypeId?: string | null; seenSerials?: Set<string> } = {}): Promise<MatchResult> {
  if (!line.isEquipment) {
    return { matchedEquipmentTypeId: null, matchedEquipmentItemId: null, matchConfidence: null, matchReason: "not equipment (fees, notes …)", resolution: "ignore" };
  }
  if (line.isContainer) {
    return ctx.kind === "delivery_note"
      ? { matchedEquipmentTypeId: null, matchedEquipmentItemId: null, matchConfidence: null, matchReason: "case - becomes a set with the items grouped under it", resolution: "create_set" }
      : { matchedEquipmentTypeId: null, matchedEquipmentItemId: null, matchConfidence: null, matchReason: "case - kept as a set, not as equipment", resolution: "ignore" };
  }

  // 1. Physical item by serial (compared without spaces/dashes), then by asset number.
  let item: ItemHit | undefined;
  let how = "";
  if (line.serialNumber) {
    const key = compact(line.serialNumber);
    if (opts.seenSerials?.has(key)) {
      return { matchedEquipmentTypeId: opts.forcedTypeId ?? null, matchedEquipmentItemId: null, matchConfidence: null, matchReason: `serial ${line.serialNumber} appears twice on this document`, resolution: "discrepancy" };
    }
    opts.seenSerials?.add(key);
    const hits = await findItems(db, ctx.workspaceId, sql`upper(regexp_replace(${s.equipmentItem.serialNumber}, '[^A-Za-z0-9]', '', 'g')) = ${key}`);
    const narrowed = opts.forcedTypeId ? hits.filter((h) => h.equipmentTypeId === opts.forcedTypeId) : hits;
    if (narrowed.length > 1) {
      return { matchedEquipmentTypeId: opts.forcedTypeId ?? null, matchedEquipmentItemId: null, matchConfidence: null, matchReason: `serial ${line.serialNumber} exists on ${narrowed.length} different products - choose the equipment type`, resolution: "pending" };
    }
    item = narrowed[0];
    how = "same serial number";
  }
  if (!item && line.assetNumber) {
    const hits = await findItems(
      db,
      ctx.workspaceId,
      sql`upper(${s.equipmentItem.assetNumber}) = upper(${line.assetNumber}) ${ctx.rentalHouseId ? sql`AND ${s.equipmentItem.rentalHouseId} = ${ctx.rentalHouseId}` : sql``}`,
    );
    if (hits.length === 1) {
      item = hits[0];
      how = "same asset number";
    }
  }

  if (item) {
    const label = itemLabel(item);
    const base = { matchedEquipmentTypeId: item.equipmentTypeId, matchedEquipmentItemId: item.id, matchConfidence: 1 };
    if (opts.forcedTypeId && opts.forcedTypeId !== item.equipmentTypeId) {
      return { ...base, matchConfidence: null, matchReason: `${how} as ${label}, but a different equipment type was chosen`, resolution: "discrepancy" };
    }
    if (ctx.kind === "inventory_list" && item.projectId && item.projectId === ctx.projectId) {
      return { ...base, matchReason: `${how} - on the project ✓`, resolution: "match_existing" };
    }
    if (ctx.kind === "delivery_note" || ctx.kind === "inventory_list") {
      if (item.projectId && item.projectId === ctx.projectId) {
        return { ...base, matchReason: `${label} is already on this project (delivered twice?)`, resolution: "discrepancy" };
      }
      if (item.projectId) {
        return { ...base, matchReason: `${label} is still on ${item.projectName ?? "another project"} - return it there first`, resolution: "discrepancy" };
      }
      if (item.rentalHouseId && ctx.rentalHouseId && item.rentalHouseId !== ctx.rentalHouseId) {
        return { ...base, matchReason: `${label} belongs to another rental house - check the serial`, resolution: "discrepancy" };
      }
      return { ...base, matchReason: `${how} - known item (${label})`, resolution: "match_existing" };
    }
    return { ...base, matchReason: `${how} - ${label}`, resolution: "match_existing" };
  }

  // 2. No physical item: which type? A reviewer's choice wins.
  if (opts.forcedTypeId) {
    return { matchedEquipmentTypeId: opts.forcedTypeId, matchedEquipmentItemId: null, matchConfidence: 1, matchReason: "type chosen by reviewer", resolution: ctx.kind === "return_note" ? "pending" : "create_new" };
  }
  const type = await findType(db, ctx.workspaceId, line);
  if (!type) {
    return { matchedEquipmentTypeId: null, matchedEquipmentItemId: null, matchConfidence: null, matchReason: "no matching equipment type - choose one or create it", resolution: "pending" };
  }
  return {
    matchedEquipmentTypeId: type.id,
    matchedEquipmentItemId: null,
    matchConfidence: type.score,
    matchReason: `${type.how}: ${type.name}${line.serialNumber ? " (new serial)" : ""}`,
    resolution: ctx.kind === "return_note" ? "pending" : "create_new",
  };
}

/** Best rental house for a printed name: exact AI match against our list, then fuzzy. */
export async function findRentalHouse(db: DbOrTx, ws: string, printed: string | null, aiMatch: string | null) {
  for (const candidate of [aiMatch, printed]) {
    if (!candidate?.trim()) continue;
    const rows = await db.execute<{ id: string; score: number }>(sql`
      SELECT id, greatest(similarity(search_normalize(${candidate}), search_text), word_similarity(search_normalize(${candidate}), search_text)) AS score
      FROM rental_house WHERE workspace_id = ${ws} AND archived_at IS NULL
      ORDER BY score DESC LIMIT 1`);
    if (rows[0] && Number(rows[0].score) >= 0.55) return rows[0].id;
  }
  return null;
}
