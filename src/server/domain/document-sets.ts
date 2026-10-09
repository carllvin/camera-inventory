/**
 * Sets suggested by a delivery note's layout: lines the AI grouped under one set
 * heading ("ALEXA 35 Set" with its components). After the note is confirmed the
 * delivered items can become a set in one click: packed, with exactly those
 * contents expected.
 */
import { and, asc, eq, inArray, isNull, notInArray, or } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import { createCase, packItem, packUnits, setExpectedFromContents } from "./cases";
import { DomainError, notFound, requireRole, type Ctx } from "./context";

export interface SetSuggestion {
  name: string;
  lines: number;
  units: number;
  itemIds: string[];
  /** The set already exists: every delivered item sits in this one. */
  existing: { id: string; name: string } | null;
  /** Created already as several identical sets: every item sits in one of these. */
  createdSets: { id: string; name: string }[];
  /** Every type comes the same number of times (≥ 2): that many identical sets. */
  copies: number;
  /** What one of those identical sets holds. */
  perCopy: { typeName: string; units: number }[];
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** How many identical sets a pile of equipment makes: the common divisor of the units per type (1 = just one). */
export function equalCopies(unitsPerType: number[]) {
  const g = unitsPerType.reduce((acc, n) => gcd(acc, n), 0);
  return unitsPerType.length > 0 && g >= 2 ? g : 1;
}

/**
 * Pack the items into the given sets in equal shares per type: whole pieces first,
 * pieces without serial split where a share needs only part of them.
 */
export async function packEqualShares(tx: DbOrTx, ctx: Ctx, caseIds: string[], itemIds: string[]) {
  const rows = await tx
    .select({ id: s.equipmentItem.id, typeId: s.equipmentItem.equipmentTypeId, quantity: s.equipmentItem.quantity, serial: s.equipmentItem.serialNumber })
    .from(s.equipmentItem)
    .where(and(eq(s.equipmentItem.workspaceId, ctx.workspaceId), inArray(s.equipmentItem.id, itemIds)))
    .orderBy(asc(s.equipmentItem.createdAt), asc(s.equipmentItem.id));
  const types = [...new Set(rows.map((r) => r.typeId))];
  for (const typeId of types) {
    const ids = rows.filter((r) => r.typeId === typeId).map((r) => r.id);
    const total = rows.filter((r) => r.typeId === typeId).reduce((n, r) => n + r.quantity, 0);
    const share = Math.floor(total / caseIds.length);
    for (const caseId of caseIds) {
      // What of this type is not in one of the new sets yet (current quantities: earlier shares may have split items).
      const pool = await tx
        .select({ id: s.equipmentItem.id, quantity: s.equipmentItem.quantity, serial: s.equipmentItem.serialNumber })
        .from(s.equipmentItem)
        .where(and(inArray(s.equipmentItem.id, ids), or(isNull(s.equipmentItem.caseId), notInArray(s.equipmentItem.caseId, caseIds))))
        .orderBy(asc(s.equipmentItem.createdAt), asc(s.equipmentItem.id));
      let need = share;
      for (const p of pool) {
        if (need <= 0) break;
        if (p.quantity > need) continue;
        await packItem(tx, ctx, caseId, p.id, { allowMove: true });
        need -= p.quantity;
      }
      const bulk = pool.filter((p) => !p.serial && p.quantity > need);
      if (need > 0 && bulk.length) await packUnits(tx, ctx, caseId, bulk.map((p) => p.id), need, { allowMove: true });
    }
  }
}

type Delivered = { id: string; typeId: string; typeName: string; quantity: number; caseId: string | null; projectId: string | null };

/**
 * The items each line of a confirmed delivery note brought (still on the project):
 * the matched item first, further units of the line from the other delivered items of its type.
 */
export async function deliveredItemsByLine(db: DbOrTx, workspaceId: string, documentId: string) {
  const lines = await db
    .select()
    .from(s.documentLine)
    .where(and(eq(s.documentLine.documentId, documentId), eq(s.documentLine.workspaceId, workspaceId), inArray(s.documentLine.resolution, ["create_new", "match_existing"])))
    .orderBy(asc(s.documentLine.lineNumber));
  const delivered: Delivered[] = await db
    .select({
      id: s.equipmentItem.id,
      typeId: s.equipmentItem.equipmentTypeId,
      typeName: s.equipmentType.name,
      quantity: s.equipmentItem.quantity,
      caseId: s.equipmentItem.caseId,
      projectId: s.equipmentItem.projectId,
    })
    .from(s.projectAssignment)
    .innerJoin(s.equipmentItem, eq(s.equipmentItem.id, s.projectAssignment.equipmentItemId))
    .innerJoin(s.equipmentType, eq(s.equipmentType.id, s.equipmentItem.equipmentTypeId))
    .where(and(eq(s.projectAssignment.deliveryDocumentId, documentId), eq(s.projectAssignment.workspaceId, workspaceId)))
    .orderBy(asc(s.equipmentItem.createdAt), asc(s.equipmentItem.id));
  const byId = new Map(delivered.map((d) => [d.id, d]));
  const used = new Set<string>();
  const items = new Map<string, Delivered[]>();
  for (const l of lines) {
    const mine: Delivered[] = [];
    const first = l.matchedEquipmentItemId ? byId.get(l.matchedEquipmentItemId) : undefined;
    if (first && !used.has(first.id) && first.projectId) {
      used.add(first.id);
      mine.push(first);
    }
    // Further units of a multi-unit line: other delivered items of the same type.
    let need = l.quantity - (mine[0]?.quantity ?? 0);
    for (const d of delivered) {
      if (need <= 0) break;
      if (d.typeId !== l.matchedEquipmentTypeId || used.has(d.id) || !d.projectId) continue;
      used.add(d.id);
      mine.push(d);
      need -= d.quantity;
    }
    items.set(l.id, mine);
  }
  return { lines, items };
}

/** Delivered items per suggested set (confirmed delivery notes only). */
export async function suggestedSets(db: DbOrTx, workspaceId: string, documentId: string): Promise<SetSuggestion[]> {
  const { lines, items: byLine } = await deliveredItemsByLine(db, workspaceId, documentId);
  const grouped = new Map<string, (typeof lines)[number][]>();
  for (const l of lines) if (l.setName) grouped.set(l.setName, [...(grouped.get(l.setName) ?? []), l]);
  if (grouped.size === 0) return [];

  const out: SetSuggestion[] = [];
  for (const [name, group] of grouped) {
    const items = group.flatMap((l) => byLine.get(l.id) ?? []);
    if (items.length === 0) continue;
    const caseIds = new Set(items.map((i) => i.caseId));
    const onlyCase = caseIds.size === 1 ? [...caseIds][0] : null;
    let existing: SetSuggestion["existing"] = null;
    let createdSets: SetSuggestion["createdSets"] = [];
    if (onlyCase) {
      const [c] = await db.select({ id: s.equipmentCase.id, name: s.equipmentCase.name }).from(s.equipmentCase).where(eq(s.equipmentCase.id, onlyCase));
      existing = c ?? null;
    } else if (caseIds.size > 1 && !caseIds.has(null)) {
      createdSets = await db
        .select({ id: s.equipmentCase.id, name: s.equipmentCase.name })
        .from(s.equipmentCase)
        .where(inArray(s.equipmentCase.id, [...caseIds] as string[]))
        .orderBy(asc(s.equipmentCase.name));
    }
    const unitsByType = new Map<string, { typeName: string; units: number }>();
    for (const i of items) {
      const t = unitsByType.get(i.typeId) ?? { typeName: i.typeName, units: 0 };
      t.units += i.quantity;
      unitsByType.set(i.typeId, t);
    }
    const copies = existing || createdSets.length ? 1 : equalCopies([...unitsByType.values()].map((t) => t.units));
    out.push({
      name,
      lines: group.length,
      units: items.reduce((n, i) => n + i.quantity, 0),
      itemIds: items.map((i) => i.id),
      existing,
      createdSets,
      copies,
      perCopy: [...unitsByType.values()].map((t) => ({ typeName: t.typeName, units: t.units / copies })),
    });
  }
  return out;
}

/** Default names for identical sets: "Walkie Set 1", "Walkie Set 2" … */
export const copyNames = (name: string, copies: number) => Array.from({ length: copies }, (_, i) => `${name.slice(0, 76)} ${i + 1}`);

/**
 * Create the suggested set: a new set on the note's project, its items packed, those contents expected.
 * With `names` (one per identical copy) the items are shared out equally over that many sets.
 */
export async function createSetFromDocument(db: DbOrTx, ctx: Ctx, documentId: string, setName: string, names?: string[]) {
  requireRole(ctx, "member");
  const [doc] = await db.select().from(s.document).where(and(eq(s.document.id, documentId), eq(s.document.workspaceId, ctx.workspaceId)));
  if (!doc) notFound("Document");
  if (doc.status !== "confirmed" || !doc.projectId) throw new DomainError("VALIDATION", "Confirm the delivery note first; then its sets can be created.");
  const suggestion = (await suggestedSets(db, ctx.workspaceId, documentId)).find((x) => x.name === setName);
  if (!suggestion) throw new DomainError("NOT_FOUND", `No set “${setName}” on this note.`);
  if (suggestion.existing) return { id: suggestion.existing.id, name: suggestion.existing.name, created: false };
  if (suggestion.createdSets.length) return { id: suggestion.createdSets[0]!.id, name: suggestion.createdSets[0]!.name, created: false };
  if (names && names.length > 1) return createSetCopies(db, ctx, doc, suggestion, names);

  return db.transaction(async (tx) => {
    // A set of that name may exist on the project already (e.g. "A-Cam Set" from another note).
    let name = setName.slice(0, 80);
    for (let n = 2; ; n++) {
      const [taken] = await tx.select({ id: s.equipmentCase.id }).from(s.equipmentCase).where(and(eq(s.equipmentCase.projectId, doc.projectId!), eq(s.equipmentCase.name, name)));
      if (!taken) break;
      name = `${setName.slice(0, 74)} (${n})`;
    }
    const c = await createCase(tx, ctx, { projectId: doc.projectId!, name, description: `From delivery note ${doc.documentNumber ?? ""}`.trim() });
    for (const id of suggestion.itemIds) await packItem(tx, ctx, c.id, id, { allowMove: true });
    await setExpectedFromContents(tx, ctx, c.id);
    return { id: c.id, name: c.name, created: true };
  });
}

async function createSetCopies(db: DbOrTx, ctx: Ctx, doc: typeof s.document.$inferSelect, suggestion: SetSuggestion, rawNames: string[]) {
  const names = rawNames.map((n) => n.replace(/\s+/g, " ").trim());
  if (names.length !== suggestion.copies) throw new DomainError("VALIDATION", `${suggestion.name} makes ${suggestion.copies} identical sets, not ${names.length}.`);
  if (names.some((n) => !n)) throw new DomainError("VALIDATION", "Give every set a name.");
  if (names.some((n) => n.length > 80)) throw new DomainError("VALIDATION", "Set names can be at most 80 characters.");
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) throw new DomainError("VALIDATION", "Each set needs its own name.");
  return db.transaction(async (tx) => {
    const ids: string[] = [];
    for (const name of names) {
      const [taken] = await tx.select({ id: s.equipmentCase.id }).from(s.equipmentCase).where(and(eq(s.equipmentCase.projectId, doc.projectId!), eq(s.equipmentCase.name, name)));
      if (taken) throw new DomainError("CONFLICT", `There is already a set called ${name} on this project.`);
      ids.push((await createCase(tx, ctx, { projectId: doc.projectId!, name, description: `From delivery note ${doc.documentNumber ?? ""}`.trim() })).id);
    }
    await packEqualShares(tx, ctx, ids, suggestion.itemIds);
    for (const id of ids) await setExpectedFromContents(tx, ctx, id);
    return { id: ids[0]!, name: names[0]!, created: true, count: ids.length };
  });
}
