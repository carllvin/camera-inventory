import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import { processImage } from "../media/images";
import type { StorageProvider } from "../storage";
import { recordEvent } from "./audit";
import { DomainError, notFound, requireRole, type Ctx } from "./context";
import { itemLabel } from "./equipment-items";

export type PhotoSubject = { caseId: string } | { equipmentItemId: string } | { equipmentTypeId: string };

export interface UploadedFile {
  name: string;
  type: string;
  bytes: Buffer;
}

/** Resolve the subject inside the workspace, returning what the photo row and audit need. */
async function resolveSubject(db: DbOrTx, ctx: Ctx, subject: PhotoSubject) {
  if ("caseId" in subject) {
    const [c] = await db
      .select({ id: s.equipmentCase.id, name: s.equipmentCase.name, projectId: s.equipmentCase.projectId })
      .from(s.equipmentCase)
      .where(and(eq(s.equipmentCase.id, subject.caseId), eq(s.equipmentCase.workspaceId, ctx.workspaceId)));
    if (!c) notFound("Case");
    return { kind: "case" as const, label: `Case ${c.name}`, values: { caseId: c.id, projectId: c.projectId }, audit: { caseId: c.id, projectId: c.projectId } };
  }
  if ("equipmentItemId" in subject) {
    const [i] = await db
      .select({ item: s.equipmentItem, typeName: s.equipmentType.name })
      .from(s.equipmentItem)
      .innerJoin(s.equipmentType, eq(s.equipmentType.id, s.equipmentItem.equipmentTypeId))
      .where(and(eq(s.equipmentItem.id, subject.equipmentItemId), eq(s.equipmentItem.workspaceId, ctx.workspaceId)));
    if (!i) notFound("Equipment item");
    return {
      kind: "equipment" as const,
      label: itemLabel({ typeName: i.typeName, ...i.item }),
      values: { equipmentItemId: i.item.id },
      audit: { equipmentItemId: i.item.id, projectId: i.item.projectId, caseId: i.item.caseId },
    };
  }
  const [t] = await db
    .select({ id: s.equipmentType.id, name: s.equipmentType.name })
    .from(s.equipmentType)
    .where(and(eq(s.equipmentType.id, subject.equipmentTypeId), eq(s.equipmentType.workspaceId, ctx.workspaceId)));
  if (!t) notFound("Equipment type");
  return { kind: "reference" as const, label: t.name, values: { equipmentTypeId: t.id }, audit: {} };
}

/** Store a photo (normalized + thumbnail) and attach it to a case, item or equipment type. */
export async function addPhoto(
  db: DbOrTx,
  storage: StorageProvider,
  ctx: Ctx,
  subject: PhotoSubject,
  file: UploadedFile,
  opts: { caption?: string | null } = {},
) {
  requireRole(ctx, "member");
  const target = await resolveSubject(db, ctx, subject);
  const img = await processImage(file.bytes);
  const id = randomUUID();
  const base = `w/${ctx.workspaceId}/photos/${id.slice(0, 2)}/${id}`;
  const storageKey = `${base}.jpg`;
  const thumbnailKey = `${base}_thumb.webp`;
  await storage.put(storageKey, img.full, "image/jpeg");
  await storage.put(thumbnailKey, img.thumb, "image/webp");
  try {
    return await db.transaction(async (tx) => {
      let isPrimary = false;
      if (target.kind === "reference") {
        const [existing] = await tx
          .select({ id: s.photo.id })
          .from(s.photo)
          .where(and(eq(s.photo.equipmentTypeId, (subject as { equipmentTypeId: string }).equipmentTypeId), eq(s.photo.isPrimary, true), isNull(s.photo.removedAt)));
        isPrimary = !existing;
      }
      const [photo] = await tx
        .insert(s.photo)
        .values({
          id,
          workspaceId: ctx.workspaceId,
          kind: target.kind,
          storageKey,
          thumbnailKey,
          mimeType: "image/jpeg",
          width: img.width,
          height: img.height,
          sizeBytes: img.full.length,
          sha256: createHash("sha256").update(file.bytes).digest("hex"),
          caption: opts.caption?.trim() || null,
          isPrimary,
          uploadedById: ctx.userId,
          ...target.values,
        })
        .returning();
      await recordEvent(tx, ctx, {
        action: "photo.added",
        entityType: target.kind === "case" ? "case" : target.kind === "reference" ? "equipment_type" : "equipment_item",
        entityId: Object.values(target.values)[0]!,
        summary: `Photo added to ${target.label}`,
        metadata: { photoId: id, fileName: file.name },
        ...target.audit,
      });
      return photo!;
    });
  } catch (err) {
    await Promise.allSettled([storage.delete(storageKey), storage.delete(thumbnailKey)]);
    throw err;
  }
}

/** Hide a photo from galleries. The file stays in storage and the history keeps a record. */
export async function removePhoto(db: DbOrTx, ctx: Ctx, photoId: string) {
  requireRole(ctx, "member");
  return db.transaction(async (tx) => {
    const [p] = await tx
      .select()
      .from(s.photo)
      .where(and(eq(s.photo.id, photoId), eq(s.photo.workspaceId, ctx.workspaceId)))
      .for("update");
    if (!p) notFound("Photo");
    if (p.removedAt) return p;
    const [updated] = await tx
      .update(s.photo)
      .set({ removedAt: new Date(), removedById: ctx.userId, isPrimary: false })
      .where(eq(s.photo.id, photoId))
      .returning();
    await recordEvent(tx, ctx, {
      action: "photo.removed",
      entityType: p.caseId ? "case" : p.equipmentItemId ? "equipment_item" : "equipment_type",
      entityId: (p.caseId ?? p.equipmentItemId ?? p.equipmentTypeId)!,
      caseId: p.caseId,
      equipmentItemId: p.equipmentItemId,
      projectId: p.projectId,
      summary: "Photo removed",
      metadata: { photoId },
    });
    return updated!;
  });
}

export async function listPhotos(db: DbOrTx, ctx: Ctx, subject: PhotoSubject) {
  const where = [eq(s.photo.workspaceId, ctx.workspaceId), isNull(s.photo.removedAt)];
  if ("caseId" in subject) where.push(eq(s.photo.caseId, subject.caseId));
  else if ("equipmentItemId" in subject) where.push(eq(s.photo.equipmentItemId, subject.equipmentItemId));
  else where.push(eq(s.photo.equipmentTypeId, subject.equipmentTypeId), eq(s.photo.kind, "reference"));
  return db
    .select({
      id: s.photo.id,
      caption: s.photo.caption,
      width: s.photo.width,
      height: s.photo.height,
      isPrimary: s.photo.isPrimary,
      createdAt: s.photo.createdAt,
      uploadedBy: s.user.name,
    })
    .from(s.photo)
    .leftJoin(s.user, eq(s.user.id, s.photo.uploadedById))
    .where(and(...where))
    .orderBy(desc(s.photo.isPrimary), desc(s.photo.createdAt));
}

/**
 * Storage key for serving a photo to a signed-in user. Membership of the photo's
 * workspace is checked here, so a guessed id from another workspace returns nothing.
 */
export async function getPhotoKeyForUser(db: DbOrTx, userId: string, photoId: string, size: "full" | "thumb") {
  const [row] = await db
    .select({ storageKey: s.photo.storageKey, thumbnailKey: s.photo.thumbnailKey })
    .from(s.photo)
    .innerJoin(
      s.workspaceMember,
      and(eq(s.workspaceMember.workspaceId, s.photo.workspaceId), eq(s.workspaceMember.userId, userId)),
    )
    .where(eq(s.photo.id, photoId));
  if (!row) return null;
  return size === "thumb" ? (row.thumbnailKey ?? row.storageKey) : row.storageKey;
}

/** Counts used by tests and admin tooling. */
export async function countPhotos(db: DbOrTx, ctx: Ctx) {
  const [r] = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM photo WHERE workspace_id = ${ctx.workspaceId} AND removed_at IS NULL`);
  return r?.n ?? 0;
}

export function assertImageUpload(file: File | null): asserts file is File {
  if (!file || file.size === 0) throw new DomainError("VALIDATION", "Choose a photo first.");
}
