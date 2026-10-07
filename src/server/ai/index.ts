import { ClaudeDocumentExtractor } from "./claude";
import { ExtractionError, type DocumentExtractor } from "./types";

export * from "./types";

/** Used when no AI provider is configured: documents are filled in by hand. */
export class ManualExtractor implements DocumentExtractor {
  readonly provider = "manual";
  readonly model = "none";
  readonly available = false;
  async extract(): Promise<never> {
    throw new ExtractionError("AI reading is not configured on this server. Enter the lines manually.", false);
  }
}

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export const DEFAULT_DOCUMENT_MODEL = "claude-sonnet-5-5";

export function createExtractorFromEnv(env: Record<string, string | undefined> = process.env): DocumentExtractor {
  const provider = env.AI_PROVIDER ?? (env.ANTHROPIC_API_KEY ? "anthropic" : "none");
  if (provider === "anthropic") {
    // Sonnet reads delivery notes well at half Opus' price; AI_MODEL / AI_EFFORT override.
    const effort = (EFFORTS as readonly string[]).includes(env.AI_EFFORT ?? "") ? (env.AI_EFFORT as (typeof EFFORTS)[number]) : "medium";
    return new ClaudeDocumentExtractor(env.AI_MODEL || DEFAULT_DOCUMENT_MODEL, effort);
  }
  return new ManualExtractor();
}

let cached: DocumentExtractor | undefined;
let override: DocumentExtractor | undefined;

export function getExtractor(): DocumentExtractor {
  if (override) return override;
  cached ??= createExtractorFromEnv();
  return cached;
}

/** Tests inject a fake provider here. */
export function setExtractorForTests(e: DocumentExtractor | undefined) {
  override = e;
}
