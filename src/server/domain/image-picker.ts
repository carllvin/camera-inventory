/**
 * Reference images for equipment types: cached search results, AI ranking,
 * applying a candidate or a pasted URL (downloaded into our storage), auto-pick.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import { ImageSearchError, type ImageRanker, type ImageSearchProvider } from "../ai/images";
import { fetchRemoteImage, type SafeFetchOptions } from "../media/safe-fetch";
import type { StorageProvider } from "../storage";
import { DomainError, notFound, requireRole, type Ctx } from "./context";
import { addPhoto } from "./photos";

/** Auto-apply only when the AI is quite sure the image shows exactly this product. */
export const AUTO_PICK_SCORE = 0.85;
const CACHE_DAYS = 14;

export interface PickerDeps {
  search: ImageSearchProvider | null;
  ranker: ImageRanker | null;
  storage: StorageProvider;
  fetchOptions?: SafeFetchOptions;
}

async function getType(db: DbOrTx, ctx: Ctx, typeId: string) {
  const [row] = await db
    .select({ type: s.equipmentType, categoryName: s.category.name })
    .from(s.equipmentType)
    .leftJoin(s.category, eq(s.category.id, s.equipmentType.categoryId))
    .where(and(eq(s.equipmentType.id, typeId), eq(s.equipmentType.workspaceId, ctx.workspaceId)));
  if (!row) notFound("Equipment type");
  return { ...row.type, categoryName: row.categoryName };
}

/** What kind of product a category holds, as a search engine understands it ("Camera Body", "Zoom Lens" …). */
const PRODUCT_WORDS: Record<string, string> = {
  "camera bodies": "Camera Body",
  viewfinders: "Viewfinder",
  "video assist": "Recorder",
  spherical: "Lens",
  anamorphic: "Anamorphic Lens",
  zoom: "Zoom Lens",
  tripods: "Tripod",
  heads: "Head",
  gimbals: "Gimbal",
  monitors: "Monitor",
  wireless: "Wireless Video",
  timecode: "Timecode",
  batteries: "Battery",
  chargers: "Charger",
  "video cables": "Cable",
  "power cables": "Cable",
  "control cables": "Cable",
};

/**
 * Default image search: manufacturer + model + the kind of product, so "ARRI ALEXA 35"
 * finds the camera body rather than accessories or sample footage. Words already in
 * the name are not repeated ("O'Connor 2575D Fluid Head" stays as is).
 */
export function defaultImageQuery(t: { manufacturer: string; model: string; categoryName?: string | null }) {
  const base = `${t.manufacturer} ${t.model}`.trim();
  const kind = t.categoryName ? PRODUCT_WORDS[t.categoryName.trim().toLowerCase()] : undefined;
  if (!kind) return base;
  const have = new Set(base.toLowerCase().split(/[^a-z0-9]+/));
  const missing = kind.split(" ").filter((w) => !have.has(w.toLowerCase()));
  return missing.length ? `${base} ${missing.join(" ")}` : base;
}

export function googleImagesUrl(query: string) {
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`;
}

export async function listCandidates(db: DbOrTx, ctx: Ctx, typeId: string) {
  return db
    .select()
    .from(s.imageCandidate)
    .where(and(eq(s.imageCandidate.workspaceId, ctx.workspaceId), eq(s.imageCandidate.equipmentTypeId, typeId)))
    .orderBy(asc(s.imageCandidate.rank));
}

/**
 * Search for candidate images (cached per type and query) and rank them.
 * Returns the stored candidates, best first.
 */
export async function searchCandidates(db: DbOrTx, ctx: Ctx, deps: PickerDeps, typeId: string, rawQuery: string | null, opts: { refresh?: boolean } = {}) {
  requireRole(ctx, "member");
  if (!deps.search) throw new DomainError("VALIDATION", "Image search is not configured on this server (BRAVE_SEARCH_API_KEY). Use “Open in Google Images” or paste an image address.");
  const type = await getType(db, ctx, typeId);
  const query = z.string().trim().min(2, "Enter a search").max(200).parse(rawQuery?.trim() || defaultImageQuery(type));

  const cached = await listCandidates(db, ctx, typeId);
  const fresh = cached.length > 0 && cached[0]!.query === query && Date.now() - cached[0]!.fetchedAt.getTime() < CACHE_DAYS * 86400_000;
  if (fresh && !opts.refresh) return cached;

  let results;
  try {
    results = (await deps.search.search(query, 20)).slice(0, 16);
  } catch (err) {
    if (err instanceof ImageSearchError) throw new DomainError("VALIDATION", err.message);
    throw err;
  }
  // Rank with the AI when available (it looks at the thumbnails); otherwise keep search order.
  const scores = new Map<number, { score: number; note: string }>();
  if (deps.ranker && results.length) {
    try {
      const ranking = await deps.ranker.rank(
        { manufacturer: type.manufacturer, model: type.model, name: type.name, aliases: type.aliases },
        results.map((r, i) => ({ index: i, url: r.thumbnailUrl ?? r.imageUrl, domain: r.sourceDomain, title: r.title })),
      );
      for (const r of ranking) {
        if (r.index >= 0 && r.index < results.length) {
          const flags = [!r.exact_product && "not the exact product", !r.shown_alone && "not alone", !r.clean_background && "busy background", r.watermark_or_text && "watermark/text"].filter(Boolean);
          scores.set(r.index, { score: Math.max(0, Math.min(1, r.score)), note: flags.length ? flags.join(", ") : r.note.slice(0, 200) });
        }
      }
    } catch (err) {
      console.error("image ranking failed", err); // ranking is a nice-to-have
    }
  }
  const ordered = results
    .map((r, i) => ({ r, i, score: scores.get(i)?.score ?? null, note: scores.get(i)?.note ?? null }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.i - b.i);

  return db.transaction(async (tx) => {
    await tx.delete(s.imageCandidate).where(and(eq(s.imageCandidate.workspaceId, ctx.workspaceId), eq(s.imageCandidate.equipmentTypeId, typeId)));
    if (ordered.length === 0) return [];
    return tx
      .insert(s.imageCandidate)
      .values(
        ordered.map((o, rank) => ({
          workspaceId: ctx.workspaceId,
          equipmentTypeId: typeId,
          query,
          source: deps.search!.name,
          imageUrl: o.r.imageUrl,
          thumbnailUrl: o.r.thumbnailUrl,
          pageUrl: o.r.pageUrl,
          title: o.r.title?.slice(0, 300) ?? null,
          sourceDomain: o.r.sourceDomain,
          width: o.r.width,
          height: o.r.height,
          rank,
          score: o.score,
          aiNote: o.note,
        })),
      )
      .returning();
  });
}

async function importImage(db: DbOrTx, ctx: Ctx, deps: PickerDeps, typeId: string, imageUrl: string, meta: { sourceUrl: string | null; attribution: string | null }) {
  const fetched = await fetchRemoteImage(imageUrl, deps.fetchOptions);
  return addPhoto(db, deps.storage, ctx, { equipmentTypeId: typeId }, { name: new URL(fetched.finalUrl).pathname.split("/").pop() || "image", type: fetched.contentType, bytes: fetched.bytes }, { ...meta, makePrimary: true });
}

/** Use a search result as the type's main reference image (downloaded into our storage). */
export async function applyCandidate(db: DbOrTx, ctx: Ctx, deps: PickerDeps, typeId: string, candidateId: string) {
  requireRole(ctx, "member");
  const [c] = await db
    .select()
    .from(s.imageCandidate)
    .where(and(eq(s.imageCandidate.id, candidateId), eq(s.imageCandidate.workspaceId, ctx.workspaceId), eq(s.imageCandidate.equipmentTypeId, typeId)));
  if (!c) notFound("Image");
  return importImage(db, ctx, deps, typeId, c.imageUrl, { sourceUrl: c.pageUrl ?? c.imageUrl, attribution: c.sourceDomain });
}

/** Use an image address the user copied (e.g. from Google Images). */
export async function applyImageUrl(db: DbOrTx, ctx: Ctx, deps: PickerDeps, typeId: string, rawUrl: string) {
  requireRole(ctx, "member");
  await getType(db, ctx, typeId);
  const url = z.url("Paste the image address (it starts with https://)").parse(rawUrl.trim());
  return importImage(db, ctx, deps, typeId, url, { sourceUrl: url, attribution: new URL(url).hostname });
}

/**
 * Find and apply an image automatically when the type has none and the AI is
 * confident. Returns what happened so the UI can say so.
 */
export async function autoPickImage(db: DbOrTx, ctx: Ctx, deps: PickerDeps, typeId: string) {
  const [existing] = await db
    .select({ id: s.photo.id })
    .from(s.photo)
    .where(and(eq(s.photo.equipmentTypeId, typeId), eq(s.photo.kind, "reference"), isNull(s.photo.removedAt)))
    .limit(1);
  if (existing) return { applied: false as const, reason: "has-image" };
  const candidates = await searchCandidates(db, ctx, deps, typeId, null);
  // With AI ranking: only confident matches. Without: the search engine's first results, in order.
  const usable = deps.ranker ? candidates.filter((x) => x.score !== null && x.score >= AUTO_PICK_SCORE) : candidates;
  if (usable.length === 0) return { applied: false as const, reason: "not-confident", candidates: candidates.length };
  for (const c of usable.slice(0, 3)) {
    try {
      const photo = await importImage(db, ctx, deps, typeId, c.imageUrl, { sourceUrl: c.pageUrl ?? c.imageUrl, attribution: `auto-selected · ${c.sourceDomain ?? "web"}` });
      return { applied: true as const, photo };
    } catch {
      // Site refused the download: try the next good candidate.
    }
  }
  return { applied: false as const, reason: "download-failed" };
}

/** Thumbnail URL of a candidate for the member-only proxy. */
export async function getCandidateThumbForUser(db: DbOrTx, userId: string, candidateId: string) {
  const [row] = await db
    .select({ url: sql<string>`coalesce(${s.imageCandidate.thumbnailUrl}, ${s.imageCandidate.imageUrl})` })
    .from(s.imageCandidate)
    .innerJoin(s.workspaceMember, and(eq(s.workspaceMember.workspaceId, s.imageCandidate.workspaceId), eq(s.workspaceMember.userId, userId)))
    .where(eq(s.imageCandidate.id, candidateId));
  return row?.url ?? null;
}
