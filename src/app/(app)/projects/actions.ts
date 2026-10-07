"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getExtractor } from "@/server/ai";
import { createDocumentFromUpload, discardDocument, runExtraction } from "@/server/domain/documents";
import { removeEquipment, type RemovalSelection } from "@/server/domain/project-removal";
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
 * Take selected cases / items off the project. With photos of the return note
 * they are stored as a return-note document that double-checks the removal.
 */
export async function removeEquipmentAction(projectId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(null, async () => {
    const ctx = await getCtx();
    const db = getDb();
    const selection: Required<RemovalSelection> = { items: [], groups: [], caseIds: fd.getAll("case").map(String) };
    for (const key of fd.getAll("row").map(String)) {
      const ids = String(fd.get(`ids_${key}`) ?? "").split(",").filter(Boolean);
      const raw = fd.get(`units_${key}`);
      if (raw === null) selection.items.push(...ids.map((id) => ({ id })));
      else selection.groups.push({ itemIds: ids, units: Math.max(1, Math.floor(Number(raw)) || 1) });
    }
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
