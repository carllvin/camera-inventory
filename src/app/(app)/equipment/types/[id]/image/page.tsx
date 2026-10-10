import { ExternalLink, Search, Star } from "lucide-react";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { PhotoUpload, RemovePhotoButton } from "@/components/photo-upload";
import { Badge, Card, CardHeader, EmptyState, NoPermission, PageHeader } from "@/components/ui";
import { cn } from "@/lib/format";
import { getPickerDeps } from "@/server/ai/picker-deps";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { getEquipmentType } from "@/server/domain/equipment-types";
import { defaultImageQuery, googleImagesUrl, listCandidates } from "@/server/domain/image-picker";
import { listPhotos } from "@/server/domain/photos";
import { assertUuid, orNotFound } from "@/server/pages";
import { getT } from "@/server/i18n";
import { searchImagesAction, setPrimaryAction, useCandidateAction, useImageUrlAction } from "../../image-actions";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Reference image") };
}

export default async function TypeImagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  assertUuid(id);
  const ctx = await getCtx();
  const t = await getT();
  if (!hasRole(ctx, "member")) return <NoPermission />;
  const db = getDb();
  const [et, photos, candidates] = await Promise.all([orNotFound(getEquipmentType(db, ctx, id)), listPhotos(db, ctx, { equipmentTypeId: id }), listCandidates(db, ctx, id)]);
  const deps = getPickerDeps();
  const query = candidates[0]?.query ?? defaultImageQuery(et);
  return (
    <>
      <PageHeader title={t("Reference image")} subtitle={et.name} back={{ href: `/equipment/types/${id}`, label: et.name }} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title={t("Find an image")} />
            <div className="space-y-4 p-4">
              <ActionForm action={searchImagesAction.bind(null, id)} className="flex flex-wrap items-end gap-2">
                <Field name="q" id="image-query" label={t("Search")} defaultValue={query} className="min-w-0 flex-1" />
                <SubmitButton pendingText={t("Searching…")} disabled={!deps.search}>
                  <Search className="size-4" /> {t("Search")}
                </SubmitButton>
                {candidates.length > 0 && (
                  <SubmitButton variant="ghost" name="refresh" value="1" pendingText="…" disabled={!deps.search}>
                    {t("Search again")}
                  </SubmitButton>
                )}
              </ActionForm>
              {!deps.search && (
                <p className="text-sm text-muted">
                  {t("Image search is not configured on this server (BRAVE_SEARCH_API_KEY). Use Google Images below and paste the image address.")}
                </p>
              )}
              {candidates.length === 0 ? (
                deps.search && <EmptyState title={t("No results yet")}>{t("Search to see candidate images.")} {deps.ranker ? t("The AI ranks them and marks the best one.") : ""}</EmptyState>
              ) : (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {candidates.map((c, i) => {
                    const suggested = i === 0 && c.score !== null && c.score >= 0.7;
                    return (
                      <li key={c.id} className={cn("overflow-hidden rounded-xl border bg-surface", suggested ? "border-accent" : "border-border")}>
                        <div className="relative flex aspect-[4/3] items-center justify-center bg-gradient-to-b from-white to-zinc-100">
                          {/* eslint-disable-next-line @next/next/no-img-element -- proxied candidate thumbnail */}
                          <img src={`/api/image-candidates/${c.id}`} alt={c.title ?? t("Candidate image")} loading="lazy" className="h-full w-full object-contain p-1.5 mix-blend-multiply" />
                          {suggested && (
                            <span className="absolute top-1.5 left-1.5">
                              <Badge tone="accent">
                                <Star className="size-3" /> {t("suggested")}
                              </Badge>
                            </span>
                          )}
                        </div>
                        <div className="space-y-1.5 p-2">
                          <div className="truncate text-xs text-muted" title={c.title ?? undefined}>
                            {c.sourceDomain ?? t("web")}
                            {c.width && c.height ? ` · ${c.width}×${c.height}` : ""}
                          </div>
                          {c.aiNote && <div className={cn("line-clamp-2 text-[11px]", c.score !== null && c.score >= 0.7 ? "text-muted" : "text-warn")}>{c.aiNote}</div>}
                          <ActionForm action={useCandidateAction.bind(null, id, c.id)}>
                            <SubmitButton variant={suggested ? "primary" : "secondary"} className="w-full !py-1.5 text-xs" pendingText={t("Saving…")}>
                              {t("Use this image")}
                            </SubmitButton>
                          </ActionForm>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title={t("Use another image")} />
            <div className="space-y-4 p-4">
              <a href={googleImagesUrl(query)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
                {t("Open in Google Images")} <ExternalLink className="size-3.5" />
              </a>
              <p className="text-xs text-muted">{t("Found a better picture? Right-click (or long-press) it → “Copy image address”, then paste it here.")}</p>
              <ActionForm action={useImageUrlAction.bind(null, id)} className="flex flex-wrap items-end gap-2" resetOnSuccess>
                <Field name="url" id="image-url" label={t("Image address")} placeholder="https://…" inputMode="url" className="min-w-0 flex-1" />
                <SubmitButton pendingText={t("Downloading…")}>{t("Use image")}</SubmitButton>
              </ActionForm>
              <div className="border-t border-border pt-4">
                <p className="mb-2 text-xs text-muted">{t("Or upload a photo you took or saved:")}</p>
                <PhotoUpload target={{ kind: "type", id }} label={t("Upload image")} />
              </div>
            </div>
          </Card>
        </div>

        <Card className="self-start">
          <CardHeader title={t("Current images ({n})", { n: photos.length })} />
          {photos.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted">{t("No image yet.")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {photos.map((p) => (
                <li key={p.id} className="flex gap-3 p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked image */}
                  <img src={`/api/photos/${p.id}?size=thumb`} alt="" className="size-16 shrink-0 rounded-md bg-white object-contain" />
                  <div className="min-w-0 flex-1 text-xs">
                    {p.isPrimary ? <Badge tone="ok">{t("main image")}</Badge> : (
                      <ActionForm action={setPrimaryAction.bind(null, id, p.id)}>
                        <SubmitButton variant="secondary" className="!px-2 !py-1 text-xs" pendingText="…">
                          {t("Make main image")}
                        </SubmitButton>
                      </ActionForm>
                    )}
                    <div className="mt-1 truncate text-muted">{p.attribution ?? t("uploaded")}</div>
                    {p.sourceUrl && (
                      <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" className="truncate text-muted hover:underline">
                        {t("source")}
                      </a>
                    )}
                  </div>
                  <RemovePhotoButton target={{ kind: "type", id }} photoId={p.id} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
