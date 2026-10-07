/**
 * "Find reference images automatically" for many equipment types at once.
 *
 * A job lists the types to process up front (image_job_item rows, in-use types
 * first), then works through them one by one with autoPickImage: an image is only
 * applied when the AI ranking is confident; everything else ends up in a review
 * list for the user. Progress is stored after every type, so a restart loses
 * nothing - an interrupted job can be resumed.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { and, asc, desc, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import { DomainError, notFound, requireRole, type Ctx } from "./context";
import { autoPickImage, type PickerDeps } from "./image-picker";

export const IMAGE_JOB_LIMITS = [25, 50, 100, 250, 500] as const;
const STALE_MINUTES = 5;

export const imageJobInput = z.object({
  scope: z.enum(["in_use", "all"]).default("in_use"),
  limit: z.coerce.number().int().refine((n) => (IMAGE_JOB_LIMITS as readonly number[]).includes(n), "Choose a limit").default(50),
});

export function imageJobAvailability(deps: Pick<PickerDeps, "search" | "ranker">) {
  if (!deps.search) return { ok: false as const, reason: "Image search is not configured (BRAVE_SEARCH_API_KEY)." };
  return { ok: true as const, aiChecked: Boolean(deps.ranker) };
}

const hasReferenceImage = (typeId: ReturnType<typeof sql>) =>
  sql`EXISTS (SELECT 1 FROM photo p WHERE p.equipment_type_id = ${typeId} AND p.kind = 'reference' AND p.removed_at IS NULL)`;
const hasItems = sql`EXISTS (SELECT 1 FROM equipment_item i WHERE i.equipment_type_id = "equipment_type"."id")`;

/** Types a new job would process: no image yet, not tried before without success. */
function eligibleTypes(db: DbOrTx, ws: string, scope: "in_use" | "all") {
  const where = [
    eq(s.equipmentType.workspaceId, ws),
    isNull(s.equipmentType.archivedAt),
    sql`NOT ${hasReferenceImage(sql`"equipment_type"."id"`)}`,
    // Already tried and left for review: don't spend searches on it again.
    notExists(
      db
        .select({ one: sql`1` })
        .from(s.imageJobItem)
        .where(and(eq(s.imageJobItem.equipmentTypeId, s.equipmentType.id), inArray(s.imageJobItem.result, ["not_confident", "download_failed"]))),
    ),
  ];
  if (scope === "in_use") where.push(hasItems);
  return db
    .select({ id: s.equipmentType.id })
    .from(s.equipmentType)
    .where(and(...where))
    .orderBy(desc(hasItems), asc(s.equipmentType.manufacturer), asc(s.equipmentType.model));
}

export async function countEligibleTypes(db: DbOrTx, ctx: Ctx) {
  const [inUse, all] = await Promise.all([eligibleTypes(db, ctx.workspaceId, "in_use"), eligibleTypes(db, ctx.workspaceId, "all")]);
  return { in_use: inUse.length, all: all.length };
}

/** Create a job with its list of types. The caller runs it (in the background). */
export async function startImageJob(db: DbOrTx, ctx: Ctx, deps: Pick<PickerDeps, "search" | "ranker">, input: z.input<typeof imageJobInput>) {
  requireRole(ctx, "admin");
  const available = imageJobAvailability(deps);
  if (!available.ok) throw new DomainError("VALIDATION", available.reason);
  const { scope, limit } = imageJobInput.parse(input);
  await releaseStaleImageJobs(db, ctx.workspaceId);
  return db.transaction(async (tx) => {
    const [running] = await tx.select({ id: s.imageJob.id }).from(s.imageJob).where(and(eq(s.imageJob.workspaceId, ctx.workspaceId), eq(s.imageJob.status, "running")));
    if (running) throw new DomainError("CONFLICT", "A search is already running. Wait for it or cancel it.");
    // A new search replaces an interrupted or failed one that was not resumed.
    await closeUnfinishedJobs(tx, ctx.workspaceId);
    const types = (await eligibleTypes(tx, ctx.workspaceId, scope)).slice(0, limit);
    if (types.length === 0) {
      throw new DomainError("VALIDATION", scope === "in_use" ? "Every equipment type with items already has an image (or is waiting in the review list)." : "Every equipment type already has an image (or is waiting in the review list).");
    }
    const [job] = await tx.insert(s.imageJob).values({ workspaceId: ctx.workspaceId, scope, total: types.length, startedById: ctx.userId }).returning();
    await tx.insert(s.imageJobItem).values(types.map((t, i) => ({ workspaceId: ctx.workspaceId, jobId: job!.id, equipmentTypeId: t.id, sortOrder: i })));
    return job!;
  });
}

/** Continue an interrupted job (server restart) with the remaining types. */
export async function resumeImageJob(db: DbOrTx, ctx: Ctx, jobId: string) {
  requireRole(ctx, "admin");
  await releaseStaleImageJobs(db, ctx.workspaceId);
  const [job] = await db
    .update(s.imageJob)
    .set({ status: "running", cancelRequested: false, lastError: null, finishedAt: null, updatedAt: new Date() })
    .where(and(eq(s.imageJob.id, jobId), eq(s.imageJob.workspaceId, ctx.workspaceId), inArray(s.imageJob.status, ["interrupted", "failed"])))
    .returning();
  if (!job) throw new DomainError("VALIDATION", "Only an interrupted or failed search can be resumed.");
  return job;
}

export async function cancelImageJob(db: DbOrTx, ctx: Ctx, jobId: string) {
  requireRole(ctx, "admin");
  const [job] = await db
    .update(s.imageJob)
    .set({ cancelRequested: true })
    .where(and(eq(s.imageJob.id, jobId), eq(s.imageJob.workspaceId, ctx.workspaceId), eq(s.imageJob.status, "running")))
    .returning({ id: s.imageJob.id });
  if (!job) notFound("Running search");
}

async function closeUnfinishedJobs(tx: DbOrTx, ws: string) {
  const open = await tx.select({ id: s.imageJob.id, processed: s.imageJob.processed }).from(s.imageJob).where(and(eq(s.imageJob.workspaceId, ws), inArray(s.imageJob.status, ["interrupted", "failed"])));
  for (const j of open) {
    await tx.delete(s.imageJobItem).where(and(eq(s.imageJobItem.jobId, j.id), eq(s.imageJobItem.result, "pending")));
    await tx.update(s.imageJob).set({ status: "cancelled", total: j.processed, finishedAt: new Date() }).where(eq(s.imageJob.id, j.id));
  }
}

/** A "running" job without a heartbeat for a while was cut off by a restart. */
export async function releaseStaleImageJobs(db: DbOrTx, ws: string) {
  await db
    .update(s.imageJob)
    .set({ status: "interrupted" })
    .where(and(eq(s.imageJob.workspaceId, ws), eq(s.imageJob.status, "running"), sql`${s.imageJob.updatedAt} < now() - make_interval(mins => ${STALE_MINUTES})`));
}

/**
 * Work through the job's pending types. `delayMs` keeps the search API within its
 * rate limit (Brave: one request per second on the free plan).
 */
export async function runImageJob(db: DbOrTx, ctx: Ctx, deps: PickerDeps, jobId: string, opts: { delayMs?: number } = {}) {
  const delayMs = opts.delayMs ?? 1100;
  let consecutiveErrors = 0;
  for (;;) {
    const [job] = await db.select().from(s.imageJob).where(and(eq(s.imageJob.id, jobId), eq(s.imageJob.workspaceId, ctx.workspaceId)));
    if (!job || job.status !== "running") return;
    if (job.cancelRequested) {
      await db.transaction(async (tx) => {
        await tx.delete(s.imageJobItem).where(and(eq(s.imageJobItem.jobId, jobId), eq(s.imageJobItem.result, "pending")));
        await tx.update(s.imageJob).set({ status: "cancelled", total: job.processed, finishedAt: new Date(), updatedAt: new Date() }).where(eq(s.imageJob.id, jobId));
      });
      return;
    }
    const [item] = await db
      .select()
      .from(s.imageJobItem)
      .where(and(eq(s.imageJobItem.jobId, jobId), eq(s.imageJobItem.result, "pending")))
      .orderBy(asc(s.imageJobItem.sortOrder))
      .limit(1);
    if (!item) {
      await db.update(s.imageJob).set({ status: "done", finishedAt: new Date(), updatedAt: new Date() }).where(eq(s.imageJob.id, jobId));
      return;
    }

    let result: "applied" | "has_image" | "not_confident" | "download_failed" | "error";
    let note: string | null = null;
    let photoId: string | null = null;
    try {
      const r = await autoPickImage(db, ctx, deps, item.equipmentTypeId);
      if (r.applied) {
        result = "applied";
        photoId = r.photo.id;
      } else if (r.reason === "has-image") result = "has_image";
      else if (r.reason === "download-failed") result = "download_failed";
      else {
        result = "not_confident";
        note = "candidates" in r && r.candidates === 0 ? "No search results" : "No result was a confident match";
      }
      consecutiveErrors = 0;
    } catch (err) {
      result = "error";
      note = err instanceof Error ? err.message.slice(0, 300) : "Unexpected error";
      consecutiveErrors++;
      if (!(err instanceof DomainError)) console.error("image job item failed", err);
    }

    await db.transaction(async (tx) => {
      await tx.update(s.imageJobItem).set({ result, note, photoId, processedAt: new Date() }).where(eq(s.imageJobItem.id, item.id));
      await tx
        .update(s.imageJob)
        .set({ processed: sql`${s.imageJob.processed} + 1`, applied: sql`${s.imageJob.applied} + ${result === "applied" ? 1 : 0}`, updatedAt: new Date() })
        .where(eq(s.imageJob.id, jobId));
    });

    // The same error three times in a row (invalid key, quota used up …): stop instead of burning through the list.
    if (consecutiveErrors >= 3) {
      await db.update(s.imageJob).set({ status: "failed", lastError: note, finishedAt: new Date(), updatedAt: new Date() }).where(eq(s.imageJob.id, jobId));
      return;
    }
    if (delayMs > 0) await sleep(delayMs);
  }
}

/** Latest job, its progress, and the types that still need a person to choose an image. */
export async function getImageJobOverview(db: DbOrTx, ctx: Ctx) {
  await releaseStaleImageJobs(db, ctx.workspaceId);
  const [job] = await db.select().from(s.imageJob).where(eq(s.imageJob.workspaceId, ctx.workspaceId)).orderBy(desc(s.imageJob.createdAt)).limit(1);
  const review = await db
    .selectDistinctOn([s.equipmentType.id], {
      id: s.equipmentType.id,
      name: s.equipmentType.name,
      result: s.imageJobItem.result,
      note: s.imageJobItem.note,
      processedAt: s.imageJobItem.processedAt,
    })
    .from(s.imageJobItem)
    .innerJoin(s.equipmentType, eq(s.equipmentType.id, s.imageJobItem.equipmentTypeId))
    .where(
      and(
        eq(s.imageJobItem.workspaceId, ctx.workspaceId),
        // Technical errors (bad key, quota) are not the type's fault: those types are simply tried again next run.
        inArray(s.imageJobItem.result, ["not_confident", "download_failed"]),
        isNull(s.equipmentType.archivedAt),
        sql`NOT ${hasReferenceImage(sql`"equipment_type"."id"`)}`,
      ),
    )
    .orderBy(s.equipmentType.id, desc(s.imageJobItem.processedAt))
    .limit(500);
  const recent = job
    ? await db
        .select({ id: s.equipmentType.id, name: s.equipmentType.name, result: s.imageJobItem.result, photoId: s.imageJobItem.photoId })
        .from(s.imageJobItem)
        .innerJoin(s.equipmentType, eq(s.equipmentType.id, s.imageJobItem.equipmentTypeId))
        .where(and(eq(s.imageJobItem.jobId, job.id), eq(s.imageJobItem.result, "applied")))
        .orderBy(desc(s.imageJobItem.processedAt))
        .limit(24)
    : [];
  return { job: job ?? null, review: review.sort((a, b) => a.name.localeCompare(b.name)), recentlyApplied: recent, eligible: await countEligibleTypes(db, ctx) };
}

/** Put a reviewed type back so the next job tries it again (e.g. after renaming it). */
export async function retryImageSearch(db: DbOrTx, ctx: Ctx, typeId: string) {
  requireRole(ctx, "admin");
  await db
    .delete(s.imageJobItem)
    .where(and(eq(s.imageJobItem.workspaceId, ctx.workspaceId), eq(s.imageJobItem.equipmentTypeId, typeId), inArray(s.imageJobItem.result, ["not_confident", "download_failed", "error"])));
}
