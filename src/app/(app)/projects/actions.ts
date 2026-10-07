"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getExtractor } from "@/server/ai";
import { createDocumentFromUpload, discardDocument, runExtraction } from "@/server/domain/documents";
import { removeEquipment, type RemovalSelection } from "@/server/domain/project-removal";
import { packItem, packUnits } from "@/server/domain/cases";
import { DomainError } from "@/server/domain/context";
import { getStorage } from "@/server/storage";
import { fromForm, runAction, type ActionState } from "@/server/actions";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { assignToProject } from "@/server/domain/equipment-items";
import { createProject, linkRentalHouse, updateProject } from "@/server/domain/projects";


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
 * Ticked rows of an equipment list: `row` = row key, `ids_<key>` = its entries,
 * `units_<key>` = how many (only for units without serial numbers).
 */
function readRows(fd: FormData) {
  const items: { id: string }[] = [];
  const groups: { itemIds: string[]; units: number }[] = [];
  for (const key of fd.getAll("row").map(String)) {
    const ids = String(fd.get(`ids_${key}`) ?? "").split(",").filter(Boolean);
    const raw = fd.get(`units_${key}`);
    if (raw === null) items.push(...ids.map((id) => ({ id })));
    else groups.push({ itemIds: ids, units: Math.max(1, Math.floor(Number(raw)) || 1) });
  }
  return { items, groups };
}

/** Pack the ticked entries of the project's equipment list into one case (moving them out of others). */
export async function packSelectionAction(projectId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const caseId = String(fd.get("caseId") ?? "");
    if (!caseId) throw new DomainError("VALIDATION", "Choose the case.");
    const { items, groups } = readRows(fd);
    if (!items.length && !groups.length) throw new DomainError("VALIDATION", "Tick what goes into the case.");
    const ctx = await getCtx();
    const units = await getDb().transaction(async (tx) => {
      let n = 0;
      for (const { id } of items) n += (await packItem(tx, ctx, caseId, id, { allowMove: true })).item.quantity;
      for (const g of groups) n += (await packUnits(tx, ctx, caseId, g.itemIds, g.units, { allowMove: true })).packed;
      return n;
    });
    revalidatePath(`/projects/${projectId}`, "layout");
    revalidatePath(`/cases/${caseId}`);
    return `${units} ${units === 1 ? "piece" : "pieces"} packed.`;
  });
}

/** "Remove…" with ticked entries: open the remove page with them preselected. */
export async function removeSelectionAction(projectId: string, fd: FormData) {
  const ids = fd.getAll("row").flatMap((k) => String(fd.get(`ids_${String(k)}`) ?? "").split(","));
  redirect(`/projects/${projectId}/remove?items=${[...new Set(ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))].join(",")}`);
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
    revalidatePath("/cases", "layout");
    if (note) {
      if (note.startExtraction) after(() => runExtraction(getDb(), getStorage(), extractor, ctx.workspaceId, note.document.id));
      redirect(`/documents/${note.document.id}`);
    }
    redirect(`/projects/${projectId}`);
  });
}
