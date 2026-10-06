"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { fromForm, runAction, type ActionState } from "@/server/actions";
import { getPickerDeps } from "@/server/ai/picker-deps";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { cancelImageJob, resumeImageJob, retryImageSearch, runImageJob, startImageJob } from "@/server/domain/image-jobs";

async function jobCtx() {
  const { workspaceId, userId, role } = await getCtx();
  return { workspaceId, userId, role };
}

/** Runs after the response; the page refreshes itself while the job is running. */
function runInBackground(ctx: Awaited<ReturnType<typeof jobCtx>>, jobId: string) {
  after(() => runImageJob(getDb(), ctx, getPickerDeps(), jobId).catch((err) => console.error("image job failed", err)));
}

export async function startImageJobAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await jobCtx();
    const job = await startImageJob(getDb(), ctx, getPickerDeps(), fromForm(fd));
    runInBackground(ctx, job.id);
    revalidatePath("/settings/images");
    return `Started: ${job.total} equipment type${job.total === 1 ? "" : "s"}.`;
  });
}

export async function resumeImageJobAction(jobId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await jobCtx();
    await resumeImageJob(getDb(), ctx, jobId);
    runInBackground(ctx, jobId);
    revalidatePath("/settings/images");
  });
}

export async function cancelImageJobAction(jobId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await cancelImageJob(getDb(), await jobCtx(), jobId);
    revalidatePath("/settings/images");
    return "Stopping after the current type…";
  });
}

export async function retryImageSearchAction(typeId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await retryImageSearch(getDb(), await jobCtx(), typeId);
    revalidatePath("/settings/images");
  });
}
