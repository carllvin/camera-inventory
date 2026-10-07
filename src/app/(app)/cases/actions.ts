"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fromForm, runAction, type ActionState } from "@/server/actions";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import {
  addExpectedLine,
  addTemplateLine,
  archiveCase,
  archiveTemplate,
  createCase,
  createTemplate,
  createTemplateFromCase,
  packByCode,
  packItem,
  packUnits,
  removeExpectedLine,
  removeTemplateLine,
  unpackItem,
  unpackUnits,
  updateCase,
  updateExpectedLine,
  updateTemplate,
  updateTemplateLine,
} from "@/server/domain/cases";

const refreshCase = (id: string, projectId?: string) => {
  revalidatePath(`/cases/${id}`);
  revalidatePath("/cases");
  if (projectId) revalidatePath(`/projects/${projectId}`, "layout");
};

export async function createCaseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const c = await createCase(getDb(), await getCtx(), fromForm(fd));
    revalidatePath(`/projects/${c.projectId}`, "layout");
    redirect(`/cases/${c.id}`);
  });
}

export async function updateCaseAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const c = await updateCase(getDb(), await getCtx(), id, fromForm(fd));
    refreshCase(id, c.projectId);
    redirect(`/cases/${id}`);
  });
}

export async function archiveCaseAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const c = await archiveCase(getDb(), await getCtx(), id);
    refreshCase(id, c.projectId);
    redirect(`/projects/${c.projectId}/cases`);
  });
}

export async function addLineAction(caseId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await addExpectedLine(getDb(), await getCtx(), caseId, fromForm(fd));
    refreshCase(caseId);
    return "Added.";
  });
}

export async function updateLineAction(caseId: string, lineId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await updateExpectedLine(getDb(), await getCtx(), lineId, fromForm(fd));
    refreshCase(caseId);
    return "Saved.";
  });
}

export async function removeLineAction(caseId: string, lineId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await removeExpectedLine(getDb(), await getCtx(), lineId);
    refreshCase(caseId);
  });
}

export async function packItemAction(caseId: string, itemId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const r = await packItem(getDb(), await getCtx(), caseId, itemId, { allowMove: fd.get("allowMove") === "1" });
    refreshCase(caseId, r.item.projectId ?? undefined);
    return r.moved ? `${r.item.label} moved here.` : `${r.item.label} packed.`;
  });
}

const unitsField = z.coerce.number().int().min(1, "At least 1");

/** Pack some or all units of a group of items without serial numbers. */
export async function packUnitsAction(caseId: string, itemIds: string[], _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const units = unitsField.parse(fd.get("units") ?? "1");
    const r = await packUnits(getDb(), await getCtx(), caseId, itemIds, units, { allowMove: fd.get("allowMove") === "1" });
    refreshCase(caseId, r.projectId);
    return `${r.label} ${r.moved ? "moved here" : "packed"}.${r.short ? ` ${r.short} fewer than asked were available.` : ""}`;
  });
}

export async function unpackUnitsAction(caseId: string, itemIds: string[], _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const units = unitsField.parse(fd.get("units") ?? "1");
    const r = await unpackUnits(getDb(), await getCtx(), itemIds, units);
    refreshCase(caseId, r.projectId ?? undefined);
    for (const id of itemIds) revalidatePath(`/equipment/${id}`);
  });
}

export async function packByCodeAction(caseId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const code = z.string().parse(fd.get("code") ?? "");
    const r = await packByCode(getDb(), await getCtx(), caseId, code, { allowMove: fd.get("allowMove") === "1" });
    refreshCase(caseId, r.item.projectId ?? undefined);
    if (r.alreadyPacked) return `${r.item.label} is already in this case.`;
    return r.moved ? `${r.item.label} moved here.` : `${r.item.label} packed.`;
  });
}

export async function unpackItemAction(caseId: string, itemId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const item = await unpackItem(getDb(), await getCtx(), itemId);
    refreshCase(caseId, item.projectId ?? undefined);
    revalidatePath(`/equipment/${itemId}`);
  });
}

export async function saveAsTemplateAction(caseId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const tpl = await createTemplateFromCase(getDb(), await getCtx(), caseId, fromForm(fd));
    redirect(`/cases/templates/${tpl.id}`);
  });
}

// ---- templates --------------------------------------------------------------

export async function createTemplateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const tpl = await createTemplate(getDb(), await getCtx(), fromForm(fd));
    redirect(`/cases/templates/${tpl.id}`);
  });
}

export async function updateTemplateAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await updateTemplate(getDb(), await getCtx(), id, fromForm(fd));
    revalidatePath(`/cases/templates/${id}`);
    return "Saved.";
  });
}

export async function archiveTemplateAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await archiveTemplate(getDb(), await getCtx(), id);
    revalidatePath("/cases/templates");
    redirect("/cases/templates");
  });
}

export async function addTemplateLineAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await addTemplateLine(getDb(), await getCtx(), id, fromForm(fd));
    revalidatePath(`/cases/templates/${id}`);
    return "Added.";
  });
}

export async function updateTemplateLineAction(id: string, lineId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await updateTemplateLine(getDb(), await getCtx(), lineId, fromForm(fd));
    revalidatePath(`/cases/templates/${id}`);
    return "Saved.";
  });
}

export async function removeTemplateLineAction(id: string, lineId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await removeTemplateLine(getDb(), await getCtx(), lineId);
    revalidatePath(`/cases/templates/${id}`);
  });
}
