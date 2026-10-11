import Link from "next/link";
import { ImageIcon, Loader2 } from "lucide-react";
import { ActionForm, Select, SubmitButton } from "@/components/forms";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { getPickerDeps } from "@/server/ai/picker-deps";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { getFormat, getT } from "@/server/i18n";
import { IMAGE_JOB_LIMITS, getImageJobOverview, imageJobAvailability } from "@/server/domain/image-jobs";
import { AutoRefresh } from "../../documents/review";
import { cancelImageJobAction, resumeImageJobAction, retryImageSearchAction, startImageJobAction } from "./actions";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Automatic images") };
}

type T = Awaited<ReturnType<typeof getT>>;

const statusOf = (t: T): Record<string, { label: string; tone: "ok" | "accent" | "danger" | "neutral" | "info" }> => ({
  running: { label: t("Running"), tone: "info" },
  done: { label: t("Finished"), tone: "ok" },
  cancelled: { label: t("Cancelled"), tone: "neutral" },
  failed: { label: t("Stopped after errors"), tone: "danger" },
  interrupted: { label: t("Interrupted"), tone: "accent" },
});

const resultOf = (t: T): Record<string, string> => ({
  not_confident: t("no confident match"),
  download_failed: t("the site refused the download"),
  error: t("error"),
});

export default async function AutomaticImagesPage() {
  const ctx = await getCtx();
  const db = getDb();
  const isAdmin = hasRole(ctx, "admin");
  const available = imageJobAvailability(getPickerDeps());
  const { job, review, recentlyApplied, eligible } = await getImageJobOverview(db, ctx);
  const running = job?.status === "running";
  const [t, f] = await Promise.all([getT(), getFormat()]);
  const STATUS = statusOf(t);
  const RESULT = resultOf(t);

  return (
    <>
      {running && <AutoRefresh intervalMs={4000} />}
      <PageHeader title={t("Automatic images")} subtitle={t("Find reference images for many equipment types at once")} back={{ href: "/settings", label: t("Settings") }} />
      <div className="grid max-w-3xl grid-cols-1 gap-6">
        <Card className="p-5">
          <p className="text-sm text-muted">
            {available.ok && available.aiChecked
              ? t(
                  "For each equipment type without an image, the server searches the web, lets the AI check the results and keeps the best one only if it clearly shows exactly that product. Uncertain cases are listed below for you to choose by hand.",
                )
              : t(
                  "For each equipment type without an image, the server searches the web and takes the first result (the next one if a site refuses the download). Types without any result are listed below.",
                )}{" "}
            {t("Images are downloaded into your own storage; you can change any of them on the type's image page. Each type costs one image search.")}
          </p>
          {!available.ok ? (
            <p className="mt-4 rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">{available.reason} {t("Add the key to the server's .env and restart the app.")}</p>
          ) : !isAdmin ? (
            <p className="mt-4 text-sm text-muted">{t("Only admins can start an automatic search.")}</p>
          ) : running ? null : (
            <ActionForm action={startImageJobAction} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
              <Select
                label={t("Which equipment types")}
                name="scope"
                id="img-scope"
                defaultValue="in_use"
                options={[
                  { value: "in_use", label: t("With items ({n} without image)", { n: eligible.in_use }) },
                  { value: "all", label: t("All types ({n} without image)", { n: eligible.all }) },
                ]}
              />
              <Select label={t("At most")} name="limit" id="img-limit" defaultValue="50" options={IMAGE_JOB_LIMITS.map((n) => ({ value: String(n), label: t("{n} types in this run", { n }) }))} />
              <div className="sm:col-span-2">
                <SubmitButton pendingText={t("Starting…")}>
                  <ImageIcon className="size-4" /> {t("Find images automatically")}
                </SubmitButton>
              </div>
            </ActionForm>
          )}
        </Card>

        {job && (
          <Card>
            <CardHeader title={t("Latest run")} />
            <div className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone={STATUS[job.status]!.tone}>{STATUS[job.status]!.label}</Badge>
                <span className="text-muted">
                  {job.scope === "in_use" ? t("types with items") : t("all types")} · {t("started {date}", { date: f.formatDateTime(job.createdAt) })}
                </span>
              </div>
              <div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={job.processed} aria-valuemax={job.total}>
                  <div className="h-full bg-accent transition-all" style={{ width: `${job.total ? Math.round((job.processed / job.total) * 100) : 0}%` }} />
                </div>
                <p className="mt-1.5 flex items-center gap-1.5 text-sm">
                  {running && <Loader2 className="size-3.5 animate-spin text-accent" />}
                  {t("{n} of {total} checked", { n: job.processed, total: job.total })} · <span className="font-medium text-ok">{t("{n} images added", { n: job.applied })}</span>
                  {job.processed - job.applied > 0 && ` · ${t("{n} without", { n: job.processed - job.applied })}`}
                </p>
              </div>
              {job.lastError && <p className="text-sm text-danger">{job.lastError}</p>}
              {isAdmin && running && (
                <ActionForm action={cancelImageJobAction.bind(null, job.id)}>
                  <SubmitButton variant="secondary" pendingText={t("Stopping…")} disabled={job.cancelRequested}>
                    {job.cancelRequested ? t("Stopping…") : t("Cancel")}
                  </SubmitButton>
                </ActionForm>
              )}
              {isAdmin && available.ok && (job.status === "interrupted" || job.status === "failed") && job.processed < job.total && (
                <ActionForm action={resumeImageJobAction.bind(null, job.id)}>
                  <SubmitButton variant="secondary" pendingText={t("Resuming…")}>
                    {t("Resume ({n} left)", { n: job.total - job.processed })}
                  </SubmitButton>
                </ActionForm>
              )}
              {recentlyApplied.length > 0 && (
                <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {recentlyApplied.map((ty) => (
                    <li key={ty.id}>
                      <Link href={`/equipment/types/${ty.id}/image`} title={ty.name} className="block overflow-hidden rounded-lg border border-border bg-white">
                        {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked photo */}
                        <img src={`/api/photos/${ty.photoId}?size=thumb`} alt={ty.name} loading="lazy" className="aspect-square w-full object-contain" />
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
            <CardHeader title={t("Choose by hand ({n})", { n: review.length })} />
            <ul className="divide-y divide-border">
              {review.map((ty) => (
                <li key={ty.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{ty.name}</div>
                    <div className="text-xs text-muted">{ty.note ?? RESULT[ty.result] ?? ty.result}</div>
                  </div>
                  <Link href={`/equipment/types/${ty.id}/image`} className="text-accent hover:underline">
                    {t("Choose image")}
                  </Link>
                  {isAdmin && (
                    <ActionForm action={retryImageSearchAction.bind(null, ty.id)}>
                      <SubmitButton variant="ghost" className="!px-2 text-xs" pendingText="…">
                        {t("Try again next run")}
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
