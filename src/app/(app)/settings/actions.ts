"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fromForm, runAction, type ActionState } from "@/server/actions";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { createCategory, updateCategory } from "@/server/domain/categories";
import { createRentalHouse, updateRentalHouse } from "@/server/domain/rental-houses";
import { importStandardCatalog } from "@/server/domain/standard-catalog";
import { addMember, changeMemberRole, renameWorkspace } from "@/server/domain/workspaces";

export async function renameWorkspaceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await renameWorkspace(getDb(), await getCtx(), fromForm(fd));
    revalidatePath("/", "layout");
    return "Workspace renamed.";
  });
}

export async function addMemberAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const u = await addMember(getDb(), await getCtx(), fromForm(fd));
    revalidatePath("/settings");
    return `${u.name} added.`;
  });
}

export async function changeRoleAction(userId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const role = z.enum(["owner", "admin", "member", "viewer"]).parse(fd.get("role"));
    await changeMemberRole(getDb(), await getCtx(), userId, role);
    revalidatePath("/settings");
    return "Role updated.";
  });
}

export async function createRentalHouseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const rh = await createRentalHouse(getDb(), await getCtx(), fromForm(fd));
    redirect(`/settings/rental-houses/${rh.id}`);
  });
}

export async function updateRentalHouseAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await updateRentalHouse(getDb(), await getCtx(), id, fromForm(fd));
    revalidatePath(`/settings/rental-houses/${id}`);
    return "Saved.";
  });
}

export async function createCategoryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const c = await createCategory(getDb(), await getCtx(), fromForm(fd));
    revalidatePath("/settings/categories");
    return `Category “${c.name}” added.`;
  });
}

export async function updateCategoryAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await updateCategory(getDb(), await getCtx(), id, fromForm(fd));
    revalidatePath("/settings/categories");
    return "Saved.";
  });
}

export async function importCatalogAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const sections = fd.getAll("sections").filter((v): v is string => typeof v === "string");
    const r = await importStandardCatalog(getDb(), await getCtx(), { sections });
    revalidatePath("/equipment", "layout");
    revalidatePath("/settings", "layout");
    return r.created === 0
      ? `Nothing new to add — all ${r.skipped} types of these areas are already in your catalog.`
      : `${r.created} equipment type${r.created === 1 ? "" : "s"} added${r.skipped ? ` (${r.skipped} already present, left unchanged)` : ""}.`;
  });
}
