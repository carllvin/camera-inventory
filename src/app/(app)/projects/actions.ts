"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getExtractor } from "@/server/ai";
import { createDocumentFromUpload, discardDocument, runExtraction } from "@/server/domain/documents";
import { removeEquipment, type RemovalSelection } from "@/server/domain/project-removal";
import { readRows } from "@/server/form-rows";
import { getStorage } from "@/server/storage";
import { fromForm, runAction, type ActionState } from "@/server/actions";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { assignToProject } from "@/server/domain/equipment-items";
import { createProject, linkRentalHouse, updateProject } from "@/server/domain/projects";
import { packItem, packUnits, unpackItem, unpackUnits } from "@/server/domain/cases";
import { DomainError } from "@/server/domain/context";
import { updateItemState } from "@/server/domain/item-state";
import { asc, inArray } from "drizzle-orm";
import * as s from "@/server/db/schema";


export async function createProjectAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getCtx();
    const p = await createProject(getDb(), ctx, fromForm(fd));
    redirect(`/projects/${p.id}`);
  });
}

export async function updateProjectAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getCtx();
    await updateProject(getDb(), ctx, id, fromForm(fd));
    revalidatePath(`/projects/${id}`, "layout");
    redirect(`/projects/${id}`);
  });
}

export async function linkRentalHouseAction(projectId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getCtx();
    await linkRentalHouse(getDb(), ctx, projectId, fromForm(fd));
    revalidatePath(`/projects/${projectId}`, "layout");
    return "Saved.";
  });
}

export async function addItemToProjectAction(projectId: string, itemId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getCtx();
    await assignToProject(getDb(), ctx, itemId, { projectId });
    revalidatePath(`/projects/${projectId}`, "layout");
    return "Added to project.";
  });
}

/**
 * Take selected cases / items off the project. With photos of the return note
 * they are stored as a return-note document that double-checks the removal.
 */
export async function removeEquipmentAction(projectId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(null, async () => {
    const ctx = await getCtx();
    const db = getDb();
    const selection: Required<RemovalSelection> = { ...readRows(fd), caseIds: fd.getAll("case").map(String) };
    const files = fd.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
    const extractor = getExtractor();
    let note: Awaited<ReturnType<typeof createDocumentFromUpload>> | null = null;
    if (files.length) {
      const uploaded = await Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()) })));
      note = await createDocumentFromUpload(db, getStorage(), ctx, extractor, { kind: "return_note", projectId }, uploaded);
    }
    try {
      await removeEquipment(db, ctx, { projectId, reason: fd.get("reason") === "removed" ? "removed" : "returned", note: String(fd.get("note") ?? ""), returnDocumentId: note?.document.id }, selection);
    } catch (err) {
      if (note) await discardDocument(db, ctx, note.document.id, "removal failed").catch(() => undefined);
      throw err;
    }
    revalidatePath(`/projects/${projectId}`, "layout");
    revalidatePath("/equipment");
    revalidatePath("/sets", "layout");
    if (note) {
      if (note.startExtraction) after(() => runExtraction(getDb(), getStorage(), extractor, ctx.workspaceId, note.document.id));
      redirect(`/documents/${note.document.id}`);
    }
    redirect(`/projects/${projectId}`);
  });
}

/**
 * Select mode on the equipment list: apply one action to the ticked entries.
 * op = "set:<id>" | "unpack" | "status:<s>" | "condition:<c>" | "remove".
 */
export async function bulkEquipmentAction(projectId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const op = String(fd.get("op") ?? "");
    const { items, groups } = readRows(fd);
    if (!items.length && !groups.length) throw new DomainError("VALIDATION", "Tick some equipment first.");
    if (!op) throw new DomainError("VALIDATION", "Choose what to do with it.");
    if (op === "remove") {
      const ids = [...items.map((i) => i.id), ...groups.flatMap((g) => g.itemIds)];
      redirect(`/projects/${projectId}/remove?items=${[...new Set(ids)].join(",")}`);
    }
    const ctx = await getCtx();
    const db = getDb();
    const [kind, value] = op.split(":") as [string, string | undefined];
    const pieces = await db.transaction(async (tx) => {
      let n = 0;
      // Units without serials: whole entries first, the last one split if only some are meant.
      const perUnits = async (g: { itemIds: string[]; units: number }, apply: (id: string, units?: number) => Promise<void>) => {
        const rows = await tx.select({ id: s.equipmentItem.id, quantity: s.equipmentItem.quantity }).from(s.equipmentItem).where(inArray(s.equipmentItem.id, g.itemIds)).orderBy(asc(s.equipmentItem.quantity));
        let left = g.units;
        for (const r of rows) {
          if (left <= 0) break;
          await apply(r.id, r.quantity > left ? left : undefined);
          left -= Math.min(left, r.quantity);
        }
        n += g.units - Math.max(left, 0);
      };
      if (kind === "set" && value) {
        for (const { id } of items) n += (await packItem(tx, ctx, value, id, { allowMove: true })).item.quantity;
        for (const g of groups) n += (await packUnits(tx, ctx, value, g.itemIds, g.units, { allowMove: true })).packed;
      } else if (kind === "unpack") {
        for (const { id } of items) n += (await unpackItem(tx, ctx, id)).quantity;
        for (const g of groups) n += (await unpackUnits(tx, ctx, g.itemIds, g.units)).taken;
      } else if (kind === "status" || kind === "condition") {
        const patch = kind === "status" ? { status: value } : { condition: value };
        for (const { id } of items) {
          await updateItemState(tx, ctx, id, patch);
          n++;
        }
        for (const g of groups) await perUnits(g, async (id, units) => void (await updateItemState(tx, ctx, id, { ...patch, units })));
      } else throw new DomainError("VALIDATION", "Unknown action.");
      return n;
    });
    revalidatePath("/", "layout");
    const what = kind === "set" ? "added to the set" : kind === "unpack" ? "taken out of their set" : kind === "status" ? "updated (status)" : "updated (condition)";
    return `${pieces} piece${pieces === 1 ? "" : "s"} ${what}.`;
  });
}
