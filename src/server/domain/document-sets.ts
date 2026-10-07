/**
 * Sets suggested by a delivery note's layout: lines the AI grouped under one set
 * heading ("ALEXA 35 Set" with its components). After the note is confirmed the
 * delivered items can become a set in one click: packed, with exactly those
 * contents expected.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import { createCase, packItem, setExpectedFromContents } from "./cases";
import { DomainError, notFound, requireRole, type Ctx } from "./context";

export interface SetSuggestion {
  name: string;
  lines: number;
  units: number;
  itemIds: string[];
  /** The set already exists: every delivered item sits in this one. */
  existing: { id: string; name: string } | null;
}

/** Delivered items per suggested set (confirmed delivery notes only). */
export async function suggestedSets(db: DbOrTx, workspaceId: string, documentId: string): Promise<SetSuggestion[]> {
  const lines = await db
    .select()
    .from(s.documentLine)
    .where(and(eq(s.documentLine.documentId, documentId), eq(s.documentLine.workspaceId, workspaceId), inArray(s.documentLine.resolution, ["create_new", "match_existing"])))
    .orderBy(asc(s.documentLine.lineNumber));
  const grouped = new Map<string, (typeof lines)[number][]>();
  for (const l of lines) if (l.setName) grouped.set(l.setName, [...(grouped.get(l.setName) ?? []), l]);
  if (grouped.size === 0) return [];

  // Everything this note delivered, by type (lines with several units only link their first item).
  const delivered = await db
    .select({ id: s.equipmentItem.id, typeId: s.equipmentItem.equipmentTypeId, quantity: s.equipmentItem.quantity, caseId: s.equipmentItem.caseId, projectId: s.equipmentItem.projectId })
    .from(s.projectAssignment)
    .innerJoin(s.equipmentItem, eq(s.equipmentItem.id, s.projectAssignment.equipmentItemId))
    .where(and(eq(s.projectAssignment.deliveryDocumentId, documentId), eq(s.projectAssignment.workspaceId, workspaceId)))
    .orderBy(asc(s.equipmentItem.createdAt), asc(s.equipmentItem.id));
  const byId = new Map(delivered.map((d) => [d.id, d]));
  const used = new Set<string>();
  const take = (id: string | null | undefined) => {
    if (!id || used.has(id) || !byId.get(id)?.projectId) return null;
    used.add(id);
    return byId.get(id)!;
  };

  const out: SetSuggestion[] = [];
  for (const [name, group] of grouped) {
    const items: (typeof delivered)[number][] = [];
    for (const l of group) {
      const first = take(l.matchedEquipmentItemId);
      if (first) items.push(first);
      // Further units of a multi-unit line: other delivered items of the same type.
      let need = l.quantity - (first?.quantity ?? 0);
      for (const d of delivered) {
        if (need <= 0) break;
        if (d.typeId !== l.matchedEquipmentTypeId || used.has(d.id) || !d.projectId) continue;
        used.add(d.id);
        items.push(d);
        need -= d.quantity;
      }
    }
    if (items.length === 0) continue;
    const caseIds = new Set(items.map((i) => i.caseId));
    const onlyCase = caseIds.size === 1 ? [...caseIds][0] : null;
    let existing: SetSuggestion["existing"] = null;
    if (onlyCase) {
      const [c] = await db.select({ id: s.equipmentCase.id, name: s.equipmentCase.name }).from(s.equipmentCase).where(eq(s.equipmentCase.id, onlyCase));
      existing = c ?? null;
    }
    out.push({ name, lines: group.length, units: items.reduce((n, i) => n + i.quantity, 0), itemIds: items.map((i) => i.id), existing });
  }
  return out;
}

/** Create the suggested set: a new set on the note's project, its items packed, those contents expected. */
export async function createSetFromDocument(db: DbOrTx, ctx: Ctx, documentId: string, setName: string) {
  requireRole(ctx, "member");
  const [doc] = await db.select().from(s.document).where(and(eq(s.document.id, documentId), eq(s.document.workspaceId, ctx.workspaceId)));
  if (!doc) notFound("Document");
  if (doc.status !== "confirmed" || !doc.projectId) throw new DomainError("VALIDATION", "Confirm the delivery note first; then its sets can be created.");
  const suggestion = (await suggestedSets(db, ctx.workspaceId, documentId)).find((x) => x.name === setName);
  if (!suggestion) throw new DomainError("NOT_FOUND", `No set “${setName}” on this note.`);
  if (suggestion.existing) return { id: suggestion.existing.id, name: suggestion.existing.name, created: false };

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
