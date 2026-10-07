"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fromForm, runAction, type ActionState } from "@/server/actions";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import {
  assignToProject,
  createItem,
  removeFromProject,
  updateItem,
} from "@/server/domain/equipment-items";
import { createEquipmentType, updateEquipmentType } from "@/server/domain/equipment-types";
import { updateItemState } from "@/server/domain/item-state";

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

/** The item page's single "Save changes": status, condition and case at once (optionally for some units). */
export async function updateItemStateAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const r = await updateItemState(getDb(), await getCtx(), id, fromForm(fd));
    refresh(id, r.item.projectId);
    if (r.item.caseId) revalidatePath(`/sets/${r.item.caseId}`);
    revalidatePath("/sets", "layout");
    if (r.changed.length === 0) return "Nothing changed.";
    const what = r.changed.join(" and ").replace(/^(\w)/, (c) => c.toUpperCase());
    return r.split ? `${what} saved for ${r.item.label} — listed separately now.` : `${what} saved.`;
  });
}
