"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionState } from "@/server/actions";
import { getPickerDeps } from "@/server/ai/picker-deps";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { applyCandidate, applyImageUrl, autoPickImage, searchCandidates } from "@/server/domain/image-picker";
import { setPrimaryReferencePhoto } from "@/server/domain/photos";

const refresh = (typeId: string) => {
  revalidatePath(`/equipment/types/${typeId}`, "layout");
  revalidatePath("/equipment", "layout");
};

export async function searchImagesAction(typeId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const list = await searchCandidates(getDb(), await getCtx(), getPickerDeps(), typeId, String(fd.get("q") ?? ""), { refresh: fd.get("refresh") === "1" });
    revalidatePath(`/equipment/types/${typeId}/image`);
    return list.length ? `${list.length} images found.` : "No images found. Try other words, or use Google Images.";
  });
}

export async function useCandidateAction(typeId: string, candidateId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await applyCandidate(getDb(), await getCtx(), getPickerDeps(), typeId, z.uuid().parse(candidateId));
    refresh(typeId);
    return "Image saved as the reference image.";
  });
}

export async function useImageUrlAction(typeId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await applyImageUrl(getDb(), await getCtx(), getPickerDeps(), typeId, String(fd.get("url") ?? ""));
    refresh(typeId);
    return "Image saved as the reference image.";
  });
}

export async function setPrimaryAction(typeId: string, photoId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await setPrimaryReferencePhoto(getDb(), await getCtx(), z.uuid().parse(photoId));
    refresh(typeId);
    return "Main image changed.";
  });
}

export async function autoPickAction(typeId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const r = await autoPickImage(getDb(), await getCtx(), getPickerDeps(), typeId);
    refresh(typeId);
    if (r.applied) return "Image found and applied (auto-selected). Not right? Use “Change image”.";
    return r.reason === "has-image" ? "This type already has an image." : "No image was clearly right. Pick one yourself.";
  });
}
