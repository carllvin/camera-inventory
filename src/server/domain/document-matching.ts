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
import type { ExtractedLine } from "../ai/types";
import { itemLabel } from "./equipment-items";

export type Resolution = "pending" | "match_existing" | "create_new" | "ignore" | "discrepancy";

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
  kind: "delivery_note" | "return_note" | "other";
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
      suggestedCategory: l.catalog_match ? null : clean(l.suggested_category ?? null),
      suggestedTracking: l.catalog_match || !["serialized", "bulk"].includes(l.suggested_tracking ?? "") ? null : l.suggested_tracking!,
    };
    const qty = Math.max(1, Math.round(l.quantity || 1));
    const serials = l.serial_numbers.map((x) => x.trim()).filter(Boolean);
    const assets = l.asset_numbers.map((x) => x.trim()).filter(Boolean);
    if (!l.is_equipment) {
      out.push({ ...base, quantity: qty, serialNumber: null, assetNumber: null });
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
  const rows = await db.execute<{ id: string; name: string; score: number }>(sql`
    SELECT id, name, greatest(
      word_similarity(search_normalize(${text}), search_text),
      word_similarity(search_normalize(${line.description}), search_text),
      similarity(search_normalize(${text}), search_text)
    ) AS score
    FROM equipment_type
    WHERE workspace_id = ${ws} AND archived_at IS NULL
    ORDER BY score DESC
    LIMIT 2`);
  const [best, second] = rows;
  if (!best || Number(best.score) < 0.5) return null;
  // Ambiguous: two types almost equally similar (e.g. TX vs RX) - let a person choose.
  if (second && Number(best.score) - Number(second.score) < 0.05) return null;
  return { id: best.id, name: best.name, score: clamp01(Number(best.score)), how: "similar name" };
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
    if (ctx.kind === "delivery_note") {
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
    return { matchedEquipmentTypeId: opts.forcedTypeId, matchedEquipmentItemId: null, matchConfidence: 1, matchReason: "type chosen by reviewer", resolution: ctx.kind === "delivery_note" ? "create_new" : "pending" };
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
    resolution: ctx.kind === "delivery_note" ? "create_new" : "pending",
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
