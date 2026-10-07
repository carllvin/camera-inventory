"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fromForm, runAction, type ActionState } from "@/server/actions";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import {
  assignToProject,
  changeCondition,
  changeStatus,
  createItem,
  removeFromProject,
  updateItem,
} from "@/server/domain/equipment-items";
import { createEquipmentType, updateEquipmentType } from "@/server/domain/equipment-types";
import { packItem, packUnits, unpackItem } from "@/server/domain/cases";

function refresh(itemId: string, projectId?: string | null) {
  revalidatePath(`/equipment/${itemId}`);
  revalidatePath("/equipment");
  if (projectId) revalidatePath(`/projects/${projectId}`, "layout");
}

export async function createItemAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getCtx();
    const item = await createItem(getDb(), ctx, fromForm(fd));
    if (item.projectId) revalidatePath(`/projects/${item.projectId}`, "layout");
    if (fd.get("$another") === "1" || fd.get("another") === "1") {
      redirect(`/equipment/new?typeId=${item.equipmentTypeId}${item.projectId ? `&projectId=${item.projectId}` : ""}${item.rentalHouseId ? `&rentalHouseId=${item.rentalHouseId}` : ""}&created=${item.id}`);
    }
    redirect(`/equipment/${item.id}`);
  });
}

export async function updateItemAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getCtx();
    const item = await updateItem(getDb(), ctx, id, fromForm(fd));
    refresh(id, item.projectId);
    redirect(`/equipment/${id}`);
  });
}

export async function changeStatusAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getCtx();
    const item = await changeStatus(getDb(), ctx, id, fromForm(fd));
    refresh(id, item.projectId);
    if (item.id !== id) return `Status updated for ${item.label} - they are now listed separately.`;
    return "Status updated.";
  });
}

export async function changeConditionAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getCtx();
    const item = await changeCondition(getDb(), ctx, id, fromForm(fd));
    refresh(id, item.projectId);
    if (item.id !== id) return `Condition updated for ${item.label} - they are now listed separately.`;
    return "Condition updated.";
  });
}

export async function assignAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getCtx();
    const item = await assignToProject(getDb(), ctx, id, fromForm(fd));
    refresh(id, item.projectId);
    return "Added to project.";
  });
}

export async function removeFromProjectAction(id: string, projectId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getCtx();
    await removeFromProject(getDb(), ctx, id, fromForm(fd));
    refresh(id, projectId);
    return "Removed from project.";
  });
}

export async function createTypeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getCtx();
    const t = await createEquipmentType(getDb(), ctx, fromForm(fd));
    const back = String(fd.get("returnTo") ?? "");
    if (back.startsWith("/equipment/new")) redirect(`${back}${back.includes("?") ? "&" : "?"}typeId=${t.id}`);
    redirect(`/equipment/types/${t.id}`);
  });
}

export async function updateTypeAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getCtx();
    await updateEquipmentType(getDb(), ctx, id, fromForm(fd));
    revalidatePath("/equipment", "layout");
    redirect(`/equipment/types/${id}`);
  });
}

/** Put the item (or some of its units) into one of its project's cases, or take it out. Choosing here is an explicit move. */
export async function setCaseAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getCtx();
    const db = getDb();
    const caseId = String(fd.get("caseId") ?? "");
    const raw = String(fd.get("units") ?? "");
    const units = raw ? Math.max(1, Math.floor(Number(raw)) || 1) : undefined;
    if (!caseId) {
      const item = await unpackItem(db, ctx, id, { units });
      refresh(id, item.projectId);
      revalidatePath("/cases", "layout");
      return item.id === id ? "Taken out of the case." : `${item.label} taken out of the case.`;
    }
    const item = units === undefined ? (await packItem(db, ctx, caseId, id, { allowMove: true })).item : null;
    const label = item ? item.label : (await packUnits(db, ctx, caseId, [id], units!, { allowMove: true })).label;
    refresh(id, item?.projectId);
    revalidatePath(`/cases/${caseId}`);
    revalidatePath("/cases", "layout");
    return `${label} is now in the case.`;
  });
}
