"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionState } from "@/server/actions";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { DomainError } from "@/server/domain/context";
import { addPhoto, removePhoto, type PhotoSubject } from "@/server/domain/photos";
import { getStorage } from "@/server/storage";

const subjectSchema = z.object({ kind: z.enum(["case", "item", "type"]), id: z.uuid() });
export type PhotoTarget = z.infer<typeof subjectSchema>;

function toSubject(t: PhotoTarget): PhotoSubject {
  return t.kind === "case" ? { caseId: t.id } : t.kind === "item" ? { equipmentItemId: t.id } : { equipmentTypeId: t.id };
}

function pathFor(t: PhotoTarget) {
  return t.kind === "case" ? `/sets/${t.id}` : t.kind === "item" ? `/equipment/${t.id}` : `/equipment/types/${t.id}`;
}

export async function uploadPhotosAction(target: PhotoTarget, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(null, async () => {
    const t = subjectSchema.parse(target);
    const ctx = await getCtx();
    const files = fd.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) throw new DomainError("VALIDATION", "Choose at least one photo.");
    if (files.length > 12) throw new DomainError("VALIDATION", "Upload at most 12 photos at once.");
    const caption = String(fd.get("caption") ?? "");
    for (const file of files) {
      await addPhoto(getDb(), getStorage(), ctx, toSubject(t), { name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) }, { caption });
    }
    revalidatePath(pathFor(t));
    return files.length === 1 ? "Photo added." : `${files.length} photos added.`;
  });
}

export async function removePhotoAction(target: PhotoTarget, photoId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const t = subjectSchema.parse(target);
    await removePhoto(getDb(), await getCtx(), z.uuid().parse(photoId));
    revalidatePath(pathFor(t));
    return "Photo removed.";
  });
}
