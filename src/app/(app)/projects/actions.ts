"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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
