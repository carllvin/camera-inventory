import Link from "next/link";
import { ImageIcon, Loader2 } from "lucide-react";
import { ActionForm, Select, SubmitButton } from "@/components/forms";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { getPickerDeps } from "@/server/ai/picker-deps";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { IMAGE_JOB_LIMITS, getImageJobOverview, imageJobAvailability } from "@/server/domain/image-jobs";
import { AutoRefresh } from "../../documents/review";
import { cancelImageJobAction, resumeImageJobAction, retryImageSearchAction, startImageJobAction } from "./actions";

export const metadata = { title: "Automatic images" };

const STATUS: Record<string, { label: string; tone: "ok" | "accent" | "danger" | "neutral" | "info" }> = {
  running: { label: "Running", tone: "info" },
  done: { label: "Finished", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  failed: { label: "Stopped after errors", tone: "danger" },
  interrupted: { label: "Interrupted", tone: "accent" },
};

const RESULT: Record<string, string> = {
  not_confident: "no confident match",
  download_failed: "the site refused the download",
  error: "error",
};

export default async function AutomaticImagesPage() {
  const ctx = await getCtx();
  const db = getDb();
  const isAdmin = hasRole(ctx, "admin");
  const available = imageJobAvailability(getPickerDeps());
  const { job, review, recentlyApplied, eligible } = await getImageJobOverview(db, ctx);
  const running = job?.status === "running";

  return (
    <>
      {running && <AutoRefresh intervalMs={4000} />}
      <PageHeader title="Automatic images" subtitle="Find reference images for many equipment types at once" back={{ href: "/settings", label: "Settings" }} />
      <div className="grid max-w-3xl grid-cols-1 gap-6">
        <Card className="p-5">
          <p className="text-sm text-muted">
            For each equipment type without an image, the server searches the web, lets the AI check the results and keeps the best one only if it clearly shows exactly
            that product. Chosen images are downloaded into your own storage. Uncertain cases are listed below for you to choose by hand. Each type costs one image search
            and one AI check — start with the types you actually have.
          </p>
          {!available.ok ? (
            <p className="mt-4 rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">{available.reason} Add the key to the server&apos;s .env and restart the app.</p>
          ) : !isAdmin ? (
            <p className="mt-4 text-sm text-muted">Only admins can start an automatic search.</p>
          ) : running ? null : (
            <ActionForm action={startImageJobAction} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
              <Select
                label="Which equipment types"
                name="scope"
                id="img-scope"
                defaultValue="in_use"
                options={[
                  { value: "in_use", label: `With items (${eligible.in_use} without image)` },
                  { value: "all", label: `All types (${eligible.all} without image)` },
                ]}
              />
              <Select label="At most" name="limit" id="img-limit" defaultValue="50" options={IMAGE_JOB_LIMITS.map((n) => ({ value: String(n), label: `${n} types in this run` }))} />
              <div className="sm:col-span-2">
                <SubmitButton pendingText="Starting…">
                  <ImageIcon className="size-4" /> Find images automatically
                </SubmitButton>
              </div>
            </ActionForm>
          )}
        </Card>

        {job && (
          <Card>
            <CardHeader title="Latest run" />
            <div className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone={STATUS[job.status]!.tone}>{STATUS[job.status]!.label}</Badge>
                <span className="text-muted">
                  {job.scope === "in_use" ? "types with items" : "all types"} · started {formatDateTime(job.createdAt)}
                </span>
              </div>
              <div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={job.processed} aria-valuemax={job.total}>
                  <div className="h-full bg-accent transition-all" style={{ width: `${job.total ? Math.round((job.processed / job.total) * 100) : 0}%` }} />
                </div>
                <p className="mt-1.5 flex items-center gap-1.5 text-sm">
                  {running && <Loader2 className="size-3.5 animate-spin text-accent" />}
                  {job.processed} of {job.total} checked · <span className="font-medium text-ok">{job.applied} images added</span>
                  {job.processed - job.applied > 0 && ` · ${job.processed - job.applied} without`}
                </p>
              </div>
              {job.lastError && <p className="text-sm text-danger">{job.lastError}</p>}
              {isAdmin && running && (
                <ActionForm action={cancelImageJobAction.bind(null, job.id)}>
                  <SubmitButton variant="secondary" pendingText="Stopping…" disabled={job.cancelRequested}>
                    {job.cancelRequested ? "Stopping…" : "Cancel"}
                  </SubmitButton>
                </ActionForm>
              )}
              {isAdmin && available.ok && (job.status === "interrupted" || job.status === "failed") && job.processed < job.total && (
                <ActionForm action={resumeImageJobAction.bind(null, job.id)}>
                  <SubmitButton variant="secondary" pendingText="Resuming…">
                    Resume ({job.total - job.processed} left)
                  </SubmitButton>
                </ActionForm>
              )}
              {recentlyApplied.length > 0 && (
                <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {recentlyApplied.map((t) => (
                    <li key={t.id}>
                      <Link href={`/equipment/types/${t.id}/image`} title={t.name} className="block overflow-hidden rounded-lg border border-border bg-white">
                        {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked photo */}
                        <img src={`/api/photos/${t.photoId}?size=thumb`} alt={t.name} loading="lazy" className="aspect-square w-full object-contain" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        )}

        {review.length > 0 && (
          <Card>
            <CardHeader title={`Choose by hand (${review.length})`} />
            <ul className="divide-y divide-border">
              {review.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-muted">{t.note ?? RESULT[t.result] ?? t.result}</div>
                  </div>
                  <Link href={`/equipment/types/${t.id}/image`} className="text-accent hover:underline">
                    Choose image
                  </Link>
                  {isAdmin && (
                    <ActionForm action={retryImageSearchAction.bind(null, t.id)}>
                      <SubmitButton variant="ghost" className="!px-2 text-xs" pendingText="…">
                        Try again next run
                      </SubmitButton>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
