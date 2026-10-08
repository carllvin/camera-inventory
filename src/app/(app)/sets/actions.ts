"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fromForm, runAction, type ActionState } from "@/server/actions";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { DomainError } from "@/server/domain/context";
import { readRows } from "@/server/form-rows";
import {
  addExpectedLine,
  setExpectedFromContents,
  stepExpectedLine,
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
  packExpected,
  updateTemplate,
  updateTemplateLine,
} from "@/server/domain/cases";

const refreshCase = (id: string, projectId?: string) => {
  revalidatePath(`/sets/${id}`);
  revalidatePath("/sets");
  if (projectId) revalidatePath(`/projects/${projectId}`, "layout");
};

export async function createCaseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getCtx();
    const c = await createCase(getDb(), ctx, fromForm(fd));
    // With expected contents from a template, pack what the project has right away.
    const packed = c.templateId ? await packExpected(getDb(), ctx, c.id) : 0;
    revalidatePath(`/projects/${c.projectId}`, "layout");
    revalidatePath("/equipment");
    redirect(`/sets/${c.id}${packed ? `?packed=${packed}` : ""}`);
  });
}

export async function updateCaseAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const c = await updateCase(getDb(), await getCtx(), id, fromForm(fd));
    refreshCase(id, c.projectId);
    redirect(`/sets/${id}`);
  });
}

export async function archiveCaseAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const c = await archiveCase(getDb(), await getCtx(), id);
    refreshCase(id, c.projectId);
    redirect(`/projects/${c.projectId}/sets`);
  });
}

export async function addLineAction(caseId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getCtx();
    await addExpectedLine(getDb(), ctx, caseId, fromForm(fd));
    const packed = await packExpected(getDb(), ctx, caseId);
    refreshCase(caseId);
    if (packed) revalidatePath("/", "layout");
    return packed ? `Added — ${packed} piece${packed === 1 ? "" : "s"} packed.` : "Added.";
  });
}

export async function stepLineAction(caseId: string, lineId: string, delta: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getCtx();
    await stepExpectedLine(getDb(), ctx, lineId, delta);
    const packed = delta > 0 ? await packExpected(getDb(), ctx, caseId) : 0;
    refreshCase(caseId);
    if (packed) revalidatePath("/", "layout");
  });
}

export async function applyContentsAction(caseId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const n = await setExpectedFromContents(getDb(), await getCtx(), caseId);
    refreshCase(caseId);
    return `Expected contents set: ${n} type${n === 1 ? "" : "s"}.`;
  });
}

export async function removeLineAction(caseId: string, lineId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await removeExpectedLine(getDb(), await getCtx(), lineId);
    refreshCase(caseId);
  });
}

const unitsField = z.coerce.number().int().min(1, "At least 1");

export async function unpackUnitsAction(caseId: string, itemIds: string[], _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const units = unitsField.parse(fd.get("units") ?? "1");
    const r = await unpackUnits(getDb(), await getCtx(), itemIds, units);
    refreshCase(caseId, r.projectId ?? undefined);
    for (const id of itemIds) revalidatePath(`/equipment/${id}`);
  });
}

/** Pack everything ticked in the checklist in one go (moving it out of other cases). */
export async function packChecklistAction(caseId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const { items, groups } = readRows(fd);
    if (!items.length && !groups.length) throw new DomainError("VALIDATION", "Tick what goes into this set.");
    const ctx = await getCtx();
    const r = await getDb().transaction(async (tx) => {
      let n = 0;
      let projectId: string | null = null;
      for (const { id } of items) {
        const p = await packItem(tx, ctx, caseId, id, { allowMove: true });
        n += p.item.quantity;
        projectId = p.item.projectId;
      }
      for (const g of groups) {
        const p = await packUnits(tx, ctx, caseId, g.itemIds, g.units, { allowMove: true });
        n += p.packed;
        projectId = p.projectId;
      }
      return { n, projectId };
    });
    refreshCase(caseId, r.projectId ?? undefined);
    return `${r.n} ${r.n === 1 ? "piece" : "pieces"} added.`;
  });
}

export async function packByCodeAction(caseId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const code = z.string().parse(fd.get("code") ?? "");
    const r = await packByCode(getDb(), await getCtx(), caseId, code, { allowMove: fd.get("allowMove") === "1" });
    refreshCase(caseId, r.item.projectId ?? undefined);
    if (r.alreadyPacked) return `${r.item.label} is already in this set.`;
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
    redirect(`/sets/templates/${tpl.id}`);
  });
}

// ---- templates --------------------------------------------------------------

export async function createTemplateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const tpl = await createTemplate(getDb(), await getCtx(), fromForm(fd));
    redirect(`/sets/templates/${tpl.id}`);
  });
}

export async function updateTemplateAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await updateTemplate(getDb(), await getCtx(), id, fromForm(fd));
    revalidatePath(`/sets/templates/${id}`);
    return "Saved.";
  });
}

export async function archiveTemplateAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await archiveTemplate(getDb(), await getCtx(), id);
    revalidatePath("/sets/templates");
    redirect("/sets/templates");
  });
}

export async function addTemplateLineAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await addTemplateLine(getDb(), await getCtx(), id, fromForm(fd));
    revalidatePath(`/sets/templates/${id}`);
    return "Added.";
  });
}

export async function updateTemplateLineAction(id: string, lineId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await updateTemplateLine(getDb(), await getCtx(), lineId, fromForm(fd));
    revalidatePath(`/sets/templates/${id}`);
    return "Saved.";
  });
}

export async function removeTemplateLineAction(id: string, lineId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await removeTemplateLine(getDb(), await getCtx(), lineId);
    revalidatePath(`/sets/templates/${id}`);
  });
}
