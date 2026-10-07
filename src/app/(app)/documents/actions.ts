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
