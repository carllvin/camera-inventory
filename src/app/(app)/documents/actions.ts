"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { fromForm, runAction, type ActionState } from "@/server/actions";
import { getExtractor } from "@/server/ai";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { DomainError } from "@/server/domain/context";
import {
  addLine,
  confirmDelivery,
  confirmReturn,
  reportLineIssue,
  createDocumentFromUpload,
  createProjectFromDocument,
  discardDocument,
  removeLine,
  requestExtraction,
  runExtraction,
  updateDocumentHeader,
  updateLine,
  createTypeFromLine,
} from "@/server/domain/documents";
import { getStorage } from "@/server/storage";
import { copyNames, createSetFromDocument, deliveredItemsByLine, suggestedSets } from "@/server/domain/document-sets";
import { changeItemType } from "@/server/domain/item-retype";
import { addFromList, finishList, removeNotOnList } from "@/server/domain/consolidate";

function scheduleExtraction(workspaceId: string, documentId: string) {
  // Runs after the response is sent; the page polls until the status changes.
  after(() => runExtraction(getDb(), getStorage(), getExtractor(), workspaceId, documentId));
}

export async function uploadDocumentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(null, async () => {
    const ctx = await getCtx();
    const files = fd.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) throw new DomainError("VALIDATION", "Add the PDF or photos of the document.");
    const uploaded = await Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()) })));
    const { document, startExtraction } = await createDocumentFromUpload(getDb(), getStorage(), ctx, getExtractor(), fromForm(fd), uploaded);
    if (startExtraction) scheduleExtraction(ctx.workspaceId, document.id);
    revalidatePath(`/projects/${document.projectId}`, "layout");
    redirect(`/documents/${document.id}`);
  });
}

export async function retryExtractionAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getCtx();
    await requestExtraction(getDb(), ctx, getExtractor(), id);
    scheduleExtraction(ctx.workspaceId, id);
    revalidatePath(`/documents/${id}`);
  });
}

export async function updateHeaderAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await updateDocumentHeader(getDb(), await getCtx(), id, fromForm(fd));
    revalidatePath(`/documents/${id}`);
    return "Saved.";
  });
}

export async function createProjectFromDocumentAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const project = await createProjectFromDocument(getDb(), await getCtx(), id, fromForm(fd));
    revalidatePath("/projects");
    revalidatePath(`/documents/${id}`);
    return `Project ${project.name} created.`;
  });
}

export async function createTypeFromLineAction(id: string, lineId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const line = await createTypeFromLine(getDb(), await getCtx(), lineId, fromForm(fd));
    revalidatePath(`/documents/${id}`);
    revalidatePath("/equipment/types");
    return line.alsoApplied ? `Created and used for ${line.alsoApplied + 1} lines.` : "Created.";
  });
}

export async function updateLineAction(id: string, lineId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const line = await updateLine(getDb(), await getCtx(), lineId, fromForm(fd));
    revalidatePath(`/documents/${id}`);
    return line.alsoApplied ? `Saved — also used for ${line.alsoApplied} more line${line.alsoApplied === 1 ? "" : "s"} with the same product.` : "Saved.";
  });
}

export async function addLineAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await addLine(getDb(), await getCtx(), id, fromForm(fd));
    revalidatePath(`/documents/${id}`);
    return "Line added.";
  });
}

export async function removeLineAction(id: string, lineId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await removeLine(getDb(), await getCtx(), lineId);
    revalidatePath(`/documents/${id}`);
  });
}

export async function confirmDeliveryAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const { document, received } = await confirmDelivery(getDb(), await getCtx(), id);
    revalidatePath(`/documents/${id}`);
    revalidatePath(`/projects/${document.projectId}`, "layout");
    revalidatePath("/equipment");
    return `Confirmed: ${received} item${received === 1 ? "" : "s"} received.`;
  });
}

export async function discardDocumentAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const reason = z.string().max(500).optional().parse(fd.get("reason") ?? undefined);
    const d = await discardDocument(getDb(), await getCtx(), id, reason?.trim() || null);
    revalidatePath(`/documents/${id}`);
    redirect(d.projectId ? `/projects/${d.projectId}/documents` : "/documents");
  });
}

export async function confirmReturnAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const { document, returned, remaining } = await confirmReturn(getDb(), await getCtx(), id);
    revalidatePath(`/documents/${id}`);
    revalidatePath(`/projects/${document.projectId}`, "layout");
    revalidatePath("/equipment");
    revalidatePath("/sets");
    return remaining > 0 ? `Return confirmed: ${returned} returned, ${remaining} still on the project.` : `Return confirmed: ${returned} returned.`;
  });
}

export async function reportLineIssueAction(id: string, lineId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const note = z.string().max(2000).optional().parse(fd.get("note") ?? undefined);
    await reportLineIssue(getDb(), await getCtx(), lineId, note?.trim() || null);
    revalidatePath(`/documents/${id}`);
    revalidatePath("/issues");
    return "Issue reported.";
  });
}

export async function createSetFromDocumentAction(id: string, setName: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    // Several names: that many identical sets (the note's group shared out equally).
    const names = [...fd.keys()].filter((k) => /^setName_\d+$/.test(k)).sort((a, b) => Number(a.slice(8)) - Number(b.slice(8))).map((k) => String(fd.get(k)));
    const r = await createSetFromDocument(getDb(), await getCtx(), id, setName, names.length > 1 ? names : undefined);
    revalidatePath(`/documents/${id}`);
    revalidatePath("/sets", "layout");
    if ("count" in r) return `${r.count} sets created.`;
    redirect(`/sets/${r.id}`);
  });
}

/** All suggested sets of the note at once. */
export async function createAllSetsFromDocumentAction(id: string, names: string[], _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getCtx();
    let created = 0;
    const copies = new Map((await suggestedSets(getDb(), ctx.workspaceId, id)).map((sg) => [sg.name, sg.copies]));
    for (const n of names) {
      const k = copies.get(n) ?? 1;
      const r = await createSetFromDocument(getDb(), ctx, id, n, k > 1 ? copyNames(n, k) : undefined);
      if (r.created) created += "count" in r ? r.count : 1;
    }
    revalidatePath(`/documents/${id}`);
    revalidatePath("/sets", "layout");
    return `${created} set${created === 1 ? "" : "s"} created.`;
  });
}

// ---- current lists ---------------------------------------------------------

function refreshList(id: string, projectId: string | null) {
  revalidatePath(`/documents/${id}`);
  if (projectId) revalidatePath(`/projects/${projectId}`, "layout");
  revalidatePath("/equipment");
}

export async function addFromListAction(id: string, lineId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const n = await addFromList(getDb(), await getCtx(), id, lineId);
    refreshList(id, null);
    revalidatePath("/", "layout");
    return `${n} piece${n === 1 ? "" : "s"} added to the project.`;
  });
}

export async function removeNotOnListAction(id: string, itemId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const n = await removeNotOnList(getDb(), await getCtx(), id, itemId);
    revalidatePath("/", "layout");
    return `${n} piece${n === 1 ? "" : "s"} taken off the project.`;
  });
}

export async function finishListAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const doc = await finishList(getDb(), await getCtx(), id);
    refreshList(id, doc.projectId);
    return "List checked and closed.";
  });
}

/** Wrong type picked while importing: move everything this line brought to the right type. */
export async function changeLineTypeAction(id: string, lineId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(null, async () => {
    const ctx = await getCtx();
    const typeId = String(fd.get("typeId") ?? "");
    if (!typeId) throw new DomainError("VALIDATION", "Choose the right equipment type.");
    const items = (await deliveredItemsByLine(getDb(), ctx.workspaceId, id)).items.get(lineId) ?? [];
    if (items.length === 0) throw new DomainError("VALIDATION", "Nothing from this line is on the project any more.");
    const r = await changeItemType(getDb(), ctx, items.map((i) => i.id), typeId, { documentLineId: lineId });
    revalidatePath("/", "layout");
    const pieces = items.reduce((n, i) => n + i.quantity, 0);
    return r.changed ? `${pieces} piece${pieces === 1 ? "" : "s"} changed to ${r.typeName}.` : `Already ${r.typeName}.`;
  });
}
