/**
 * Matching for return notes: every line must point at equipment that is currently
 * on the document's project. Anything else is a discrepancy for the reviewer -
 * nothing is ever marked returned (or missing) on a guess.
 */
import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import { findType, type MatchResult, type ProposedLine } from "./document-matching";
import { itemLabel } from "./equipment-items";

export interface ReturnLine extends ProposedLine {
  ignored: boolean;
  chosenItemId: string | null;
  chosenTypeId: string | null;
  /** Type matched earlier (e.g. via the AI's catalog match); used before fuzzy search. */
  hintTypeId?: string | null;
}

interface ProjectItem {
  id: string;
  equipmentTypeId: string;
  typeName: string;
  trackingMode: string;
  quantity: number;
  serialNumber: string | null;
  assetNumber: string | null;
  rentalHouseId: string | null;
  rentalHouseName: string | null;
}

const compact = (v: string | null | undefined) => (v ? v.toUpperCase().replace(/[^A-Z0-9]/g, "") : "");

export async function loadProjectItems(db: DbOrTx, workspaceId: string, projectId: string): Promise<ProjectItem[]> {
  return db
    .select({
      id: s.equipmentItem.id,
      equipmentTypeId: s.equipmentItem.equipmentTypeId,
      typeName: s.equipmentType.name,
      trackingMode: s.equipmentItem.trackingMode,
      quantity: s.equipmentItem.quantity,
      serialNumber: s.equipmentItem.serialNumber,
      assetNumber: s.equipmentItem.assetNumber,
      rentalHouseId: s.equipmentItem.rentalHouseId,
      rentalHouseName: s.rentalHouse.name,
    })
    .from(s.equipmentItem)
    .innerJoin(s.equipmentType, eq(s.equipmentType.id, s.equipmentItem.equipmentTypeId))
    .leftJoin(s.rentalHouse, eq(s.rentalHouse.id, s.equipmentItem.rentalHouseId))
    .where(and(eq(s.equipmentItem.workspaceId, workspaceId), eq(s.equipmentItem.projectId, projectId)))
    .orderBy(s.equipmentType.name, s.equipmentItem.serialNumber, s.equipmentItem.createdAt);
}

/** Why an identified item that is not on this project can't be returned with this note. */
async function explainElsewhere(db: DbOrTx, workspaceId: string, line: ReturnLine) {
  const conds = [];
  if (line.serialNumber) conds.push(sql`upper(regexp_replace(${s.equipmentItem.serialNumber}, '[^A-Za-z0-9]', '', 'g')) = ${compact(line.serialNumber)}`);
  if (line.assetNumber) conds.push(sql`upper(${s.equipmentItem.assetNumber}) = upper(${line.assetNumber})`);
  if (line.chosenItemId) conds.push(sql`${s.equipmentItem.id} = ${line.chosenItemId}`);
  if (!conds.length) return null;
  const [hit] = await db
    .select({ id: s.equipmentItem.id, typeId: s.equipmentItem.equipmentTypeId, typeName: s.equipmentType.name, serialNumber: s.equipmentItem.serialNumber, status: s.equipmentItem.status, projectName: s.project.name, quantity: s.equipmentItem.quantity, trackingMode: s.equipmentItem.trackingMode })
    .from(s.equipmentItem)
    .innerJoin(s.equipmentType, eq(s.equipmentType.id, s.equipmentItem.equipmentTypeId))
    .leftJoin(s.project, eq(s.project.id, s.equipmentItem.projectId))
    .where(and(eq(s.equipmentItem.workspaceId, workspaceId), sql`(${sql.join(conds, sql` OR `)})`))
    .limit(1);
  if (!hit) return null;
  const label = itemLabel(hit);
  const reason =
    hit.status === "returned"
      ? `${label} was already returned`
      : hit.projectName
        ? `${label} is on ${hit.projectName}, not on this project`
        : `${label} is not on any project`;
  return { itemId: hit.id, typeId: hit.typeId, reason };
}

/**
 * Match all lines of a return note at once (lines compete for the same items).
 * Returns one result per input line, in order.
 */
export async function matchReturnLines(db: DbOrTx, ctx: { workspaceId: string; projectId: string | null; rentalHouseId: string | null }, lines: ReturnLine[]): Promise<MatchResult[]> {
  const results: (MatchResult | null)[] = lines.map(() => null);
  const none = { matchedEquipmentTypeId: null, matchedEquipmentItemId: null, matchConfidence: null };
  if (!ctx.projectId) {
    return lines.map((l) => (l.ignored ? { ...none, matchReason: "ignored by reviewer", resolution: "ignore" as const } : { ...none, matchReason: "choose the project first", resolution: "pending" as const }));
  }
  const items = await loadProjectItems(db, ctx.workspaceId, ctx.projectId);
  const byId = new Map(items.map((i) => [i.id, i]));
  const claimed = new Map<string, number>();
  const remaining = (i: ProjectItem) => i.quantity - (claimed.get(i.id) ?? 0);
  const claim = (i: ProjectItem, units: number) => claimed.set(i.id, (claimed.get(i.id) ?? 0) + units);
  const wrongHouse = (i: ProjectItem) => Boolean(ctx.rentalHouseId && i.rentalHouseId && i.rentalHouseId !== ctx.rentalHouseId);

  const accept = (idx: number, item: ProjectItem, line: ReturnLine, how: string) => {
    const label = itemLabel(item);
    if (wrongHouse(item)) {
      results[idx] = { matchedEquipmentTypeId: item.equipmentTypeId, matchedEquipmentItemId: item.id, matchConfidence: null, matchReason: `${label} belongs to ${item.rentalHouseName ?? "another rental house"}, not to the rental house of this note`, resolution: "discrepancy" };
      return;
    }
    const units = item.trackingMode === "bulk" ? line.quantity : 1;
    if (item.trackingMode === "bulk" && units > remaining(item)) {
      results[idx] = { matchedEquipmentTypeId: item.equipmentTypeId, matchedEquipmentItemId: item.id, matchConfidence: null, matchReason: `only ${remaining(item)} of ${item.typeName} left on the project, note says ${units}`, resolution: "discrepancy" };
      return;
    }
    if (item.trackingMode !== "bulk" && line.quantity !== 1) {
      results[idx] = { matchedEquipmentTypeId: item.equipmentTypeId, matchedEquipmentItemId: item.id, matchConfidence: null, matchReason: `quantity ${line.quantity} for one individually tracked item - split the line`, resolution: "discrepancy" };
      return;
    }
    claim(item, units);
    const partial = item.trackingMode === "bulk" && units < item.quantity ? ` (${units} of ${item.quantity} - the rest stays)` : "";
    results[idx] = { matchedEquipmentTypeId: item.equipmentTypeId, matchedEquipmentItemId: item.id, matchConfidence: 1, matchReason: `${how}: ${label}${partial}`, resolution: "match_existing" };
  };

  // Pass 0: ignored lines.
  lines.forEach((l, idx) => {
    if (l.ignored || !l.isEquipment) results[idx] = { ...none, matchReason: l.ignored ? "ignored by reviewer" : "not equipment (fees, notes …)", resolution: "ignore" };
  });

  // Pass 1: items picked by the reviewer.
  for (const [idx, l] of lines.entries()) {
    if (results[idx] || !l.chosenItemId) continue;
    const item = byId.get(l.chosenItemId);
    if (item && (item.trackingMode === "bulk" || remaining(item) > 0)) accept(idx, item, l, "chosen by reviewer");
    else if (item) results[idx] = { matchedEquipmentTypeId: item.equipmentTypeId, matchedEquipmentItemId: item.id, matchConfidence: null, matchReason: `${itemLabel(item)} is already on another line of this note`, resolution: "discrepancy" };
    else {
      const why = await explainElsewhere(db, ctx.workspaceId, l);
      results[idx] = { matchedEquipmentTypeId: why?.typeId ?? null, matchedEquipmentItemId: why?.itemId ?? null, matchConfidence: null, matchReason: why?.reason ?? "item not found", resolution: "discrepancy" };
    }
  }

  // Pass 2: serial / asset numbers.
  const seenSerials = new Set<string>();
  for (const [idx, l] of lines.entries()) {
    if (results[idx] || (!l.serialNumber && !l.assetNumber)) continue;
    const key = compact(l.serialNumber);
    if (key && seenSerials.has(key)) {
      results[idx] = { ...none, matchReason: `serial ${l.serialNumber} appears twice on this note`, resolution: "discrepancy" };
      continue;
    }
    if (key) seenSerials.add(key);
    const typeFilter = (i: ProjectItem) => !l.chosenTypeId || i.equipmentTypeId === l.chosenTypeId;
    const bySerial = key ? items.filter((i) => compact(i.serialNumber) === key && typeFilter(i)) : [];
    const byAsset = !bySerial.length && l.assetNumber ? items.filter((i) => i.assetNumber && i.assetNumber.toUpperCase() === l.assetNumber!.toUpperCase() && typeFilter(i)) : [];
    const hits = bySerial.length ? bySerial : byAsset;
    if (hits.length === 1) {
      if (remaining(hits[0]!) <= 0 && hits[0]!.trackingMode !== "bulk") results[idx] = { ...none, matchedEquipmentItemId: hits[0]!.id, matchReason: `${itemLabel(hits[0]!)} is already on another line of this note`, resolution: "discrepancy" };
      else accept(idx, hits[0]!, l, bySerial.length ? "same serial number" : "same asset number");
      continue;
    }
    if (hits.length > 1) {
      results[idx] = { ...none, matchReason: `serial ${l.serialNumber} matches ${hits.length} products on this project - choose the item`, resolution: "pending" };
      continue;
    }
    const why = await explainElsewhere(db, ctx.workspaceId, l);
    results[idx] = {
      matchedEquipmentTypeId: why?.typeId ?? null,
      matchedEquipmentItemId: why?.itemId ?? null,
      matchConfidence: null,
      matchReason: why?.reason ?? `no item with ${l.serialNumber ? `serial ${l.serialNumber}` : `asset ${l.assetNumber}`} on this project (unknown equipment)`,
      resolution: "discrepancy",
    };
  }

  // Pass 3: lines without identifiers, by equipment type.
  const pendingByType = new Map<string, number[]>();
  for (const [idx, l] of lines.entries()) {
    if (results[idx]) continue;
    const typeId = l.chosenTypeId ?? l.hintTypeId ?? (await findType(db, ctx.workspaceId, l))?.id ?? null;
    if (!typeId) {
      results[idx] = { ...none, matchReason: "which item is this? choose it from the project's equipment", resolution: "pending" };
      continue;
    }
    pendingByType.set(typeId, [...(pendingByType.get(typeId) ?? []), idx]);
  }
  for (const [typeId, idxs] of pendingByType) {
    const candidates = items.filter((i) => i.equipmentTypeId === typeId && !wrongHouse(i) && remaining(i) > 0);
    const typeName = items.find((i) => i.equipmentTypeId === typeId)?.typeName ?? "this equipment";
    const bulk = candidates.length > 0 && candidates.every((c) => c.trackingMode === "bulk");
    if (bulk) {
      for (const idx of idxs) {
        const l = lines[idx]!;
        const fit = candidates.find((c) => remaining(c) >= l.quantity);
        if (fit) accept(idx, fit, l, "same equipment type");
        else results[idx] = { matchedEquipmentTypeId: typeId, matchedEquipmentItemId: null, matchConfidence: null, matchReason: `only ${candidates.reduce((n, c) => n + remaining(c), 0)} ${typeName} left on the project from this rental house, note says ${l.quantity}`, resolution: "discrepancy" };
      }
      continue;
    }
    const units = idxs.reduce((n, idx) => n + lines[idx]!.quantity, 0);
    if (candidates.length === 0) {
      for (const idx of idxs) results[idx] = { matchedEquipmentTypeId: typeId, matchedEquipmentItemId: null, matchConfidence: null, matchReason: `no ${typeName} from this rental house left on the project`, resolution: "discrepancy" };
    } else if (candidates.length === units && idxs.every((idx) => lines[idx]!.quantity === 1)) {
      // Exactly as many on the project as on the note: unambiguous.
      idxs.forEach((idx, n) => accept(idx, candidates[n]!, lines[idx]!, `the only ${candidates.length === 1 ? "one" : `${candidates.length}`} on the project`));
    } else {
      for (const idx of idxs) {
        results[idx] = {
          matchedEquipmentTypeId: typeId,
          matchedEquipmentItemId: null,
          matchConfidence: null,
          matchReason: candidates.length < units ? `note lists ${units} ${typeName}, only ${candidates.length} on the project` : `${candidates.length} ${typeName} on the project - choose which one is returned`,
          resolution: candidates.length < units ? "discrepancy" : "pending",
        };
      }
    }
  }
  return results.map((r) => r ?? { ...none, matchReason: "not matched", resolution: "pending" as const });
}

/** For extraction: split "3 × ALEXA 35" without serials into three lines when the type is individually tracked. */
export async function expandReturnLines(db: DbOrTx, workspaceId: string, lines: ProposedLine[]): Promise<ProposedLine[]> {
  const out: ProposedLine[] = [];
  for (const l of lines) {
    if (l.isEquipment && l.quantity > 1 && !l.serialNumber && !l.assetNumber) {
      const type = await findType(db, workspaceId, l);
      if (type) {
        const [t] = await db.select({ mode: s.equipmentType.defaultTrackingMode }).from(s.equipmentType).where(eq(s.equipmentType.id, type.id));
        if (t?.mode === "serialized") {
          for (let i = 0; i < l.quantity; i++) out.push({ ...l, quantity: 1 });
          continue;
        }
      }
    }
    out.push(l);
  }
  return out;
}
