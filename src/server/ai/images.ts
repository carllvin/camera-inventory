/**
 * Reference-image search and ranking. Search: Brave Image Search API (official API,
 * own key). Ranking: Claude looks at the thumbnails and scores how well each shows
 * exactly this product, alone, on a clean background, without watermarks.
 * Both are optional; the picker also offers "Open in Google Images" and "paste URL".
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export interface ImageSearchResult {
  imageUrl: string;
  thumbnailUrl: string | null;
  pageUrl: string | null;
  title: string | null;
  sourceDomain: string | null;
  width: number | null;
  height: number | null;
}

export interface ImageSearchProvider {
  readonly name: string;
  search(query: string, count: number): Promise<ImageSearchResult[]>;
}

export class ImageSearchError extends Error {}

const braveResponse = z.object({
  results: z
    .array(
      z.object({
        title: z.string().nullish(),
        url: z.string().nullish(),
        source: z.string().nullish(),
        thumbnail: z.object({ src: z.string().nullish() }).nullish(),
        properties: z.object({ url: z.string().nullish(), width: z.number().nullish(), height: z.number().nullish() }).nullish(),
        meta_url: z.object({ hostname: z.string().nullish() }).nullish(),
      }),
    )
    .default([]),
});

export class BraveImageSearch implements ImageSearchProvider {
  readonly name = "brave";
  constructor(
    private readonly apiKey: string,
    private readonly endpoint = "https://api.search.brave.com/res/v1/images/search",
  ) {}

  async search(query: string, count: number): Promise<ImageSearchResult[]> {
    const url = new URL(this.endpoint);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(Math.min(Math.max(count, 1), 50)));
    url.searchParams.set("safesearch", "strict");
    const res = await fetch(url, {
      headers: { Accept: "application/json", "X-Subscription-Token": this.apiKey },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {
      throw new ImageSearchError("Image search is unreachable. Try again.");
    });
    if (res.status === 401 || res.status === 403) throw new ImageSearchError("The image search API key is invalid (BRAVE_SEARCH_API_KEY).");
    if (res.status === 429) throw new ImageSearchError("Image search limit reached. Try again later.");
    if (!res.ok) throw new ImageSearchError(`Image search failed (${res.status}).`);
    const data = braveResponse.parse(await res.json());
    return data.results
      .map((r) => ({
        imageUrl: r.properties?.url ?? "",
        thumbnailUrl: r.thumbnail?.src ?? null,
        pageUrl: r.url ?? null,
        title: r.title ?? null,
        sourceDomain: r.meta_url?.hostname ?? r.source ?? null,
        width: r.properties?.width ?? null,
        height: r.properties?.height ?? null,
      }))
      .filter((r) => /^https?:\/\//.test(r.imageUrl));
  }
}

export function createImageSearchFromEnv(env: Record<string, string | undefined> = process.env): ImageSearchProvider | null {
  return env.BRAVE_SEARCH_API_KEY ? new BraveImageSearch(env.BRAVE_SEARCH_API_KEY) : null;
}

// ---------------------------------------------------------------------------
// Ranking with Claude
// ---------------------------------------------------------------------------

const rankingSchema = z.object({
  candidates: z.array(
    z.object({
      index: z.number().int(),
      /** 0–1: how suitable as the reference image for this exact product. */
      score: z.number(),
      exact_product: z.boolean(),
      shown_alone: z.boolean(),
      clean_background: z.boolean(),
      watermark_or_text: z.boolean(),
      note: z.string(),
    }),
  ),
});
export type ImageRanking = z.infer<typeof rankingSchema>["candidates"];

const { type: rankingFormatType, schema: rankingJsonSchema } = betaZodOutputFormat(rankingSchema);

export interface ImageRanker {
  rank(product: { manufacturer: string; model: string; name: string; aliases: string[] }, candidates: { index: number; url: string; domain: string | null; title: string | null }[]): Promise<ImageRanking>;
}

export class ClaudeImageRanker implements ImageRanker {
  private readonly client: Anthropic;
  constructor(
    private readonly model: string,
    client?: Anthropic,
  ) {
    this.client = client ?? new Anthropic();
  }

  async rank(product: { manufacturer: string; model: string; name: string; aliases: string[] }, candidates: { index: number; url: string; domain: string | null; title: string | null }[]) {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const c of candidates) {
      content.push({ type: "text", text: `Candidate ${c.index}${c.domain ? ` (from ${c.domain})` : ""}${c.title ? `: ${c.title}` : ""}` });
      content.push({ type: "image", source: { type: "url", url: c.url } });
    }
    content.push({
      type: "text",
      text: `Product: ${product.name} (manufacturer: ${product.manufacturer}, model: ${product.model}${product.aliases.length ? `, also called: ${product.aliases.join(", ")}` : ""}).

Score every candidate as the catalog reference image for exactly this product. Best: the exact product (not a sibling model, not an accessory or a rig built around it), shown alone, on a plain light background, no watermark or overlaid text, sharp, product filling most of the frame. Images from the manufacturer's own site are usually the best choice.`,
    });
    const stream = this.client.beta.messages.stream({
      model: this.model,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: rankingFormatType, schema: rankingJsonSchema } },
      messages: [{ role: "user", content }],
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal" || message.stop_reason === "max_tokens") return [];
    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    try {
      return rankingSchema.parse(JSON.parse(text)).candidates;
    } catch {
      return [];
    }
  }
}

/**
 * AI ranking of image results is opt-in (IMAGE_AI_RANKING=true). By default the
 * search engine's order is used and the automatic pick takes the first result.
 */
export function createImageRankerFromEnv(env: Record<string, string | undefined> = process.env): ImageRanker | null {
  const enabled = ["1", "true", "on", "yes"].includes((env.IMAGE_AI_RANKING ?? "").toLowerCase());
  return enabled && env.ANTHROPIC_API_KEY && env.AI_PROVIDER !== "none" ? new ClaudeImageRanker(env.AI_MODEL || "claude-opus-5-5") : null;
}
