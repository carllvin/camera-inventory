import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import sharp from "sharp";
import {
  ExtractionError,
  extractionSchema,
  type DocumentExtractor,
  type ExtractionContext,
  type ExtractionInputFile,
  type ExtractionResult,
} from "./types";

/**
 * JSON schema for structured output. We send the plain schema (not the SDK's
 * auto-parsing format) so stop reasons are checked before parsing: a truncated
 * or refused response must become a clear message, not a JSON syntax error.
 */
const { type: formatType, schema: outputSchema } = betaZodOutputFormat(extractionSchema);

const SYSTEM_PROMPT = `You read rental paperwork for a film camera department: delivery notes (Lieferschein) and return notes (Rücklieferschein / Retoure) from camera, lens, grip and lighting rental houses. Documents are often German or English, sometimes multi-page, sometimes photographed at an angle.

Extract exactly what is printed. The output is reviewed by a camera assistant before any inventory changes, so a blank field is far better than a guess: never invent serial numbers, asset numbers, quantities or dates.

Lines
- One output line per item line on the document, in document order.
- If a line lists several serial numbers, put all of them in serial_numbers (quantity stays as printed).
- Sets and kits (e.g. "ALEXA 35 Set" with indented components) - output the set line and each listed component as separate lines; components without their own quantity have quantity 1 per set.
- Mark transport, insurance, deposits, discounts, subtotals, signatures and free-text remarks as is_equipment: false.
- quantity is the number of units delivered/returned on that line (use 1 if no quantity is printed for an item).
- Asset numbers are the rental house's inventory numbers (often labelled Inv.-Nr., Asset, ID, Barcode); serial numbers are manufacturer serials (S/N, SN, Seriennr.).
- catalog_match: if the line is clearly the same product as one entry of the provided equipment catalog, copy that entry exactly (aliases count); otherwise null. Do not match merely similar products (e.g. a different focal length or a TX vs. RX).
- confidence reflects how certain the reading of that line is (smudged, handwritten or cut-off text lowers it).

Header
- rental_house_name as printed; rental_house_match = exact entry from the provided rental-house list if it is clearly the same company, else null.
- document_date as YYYY-MM-DD.
- Add a warning for anything a reviewer must check: unreadable parts, handwritten corrections, crossed-out lines, pages that seem to be missing.`;

function contextBlock(ctx: ExtractionContext) {
  const houses = ctx.rentalHouses.length ? ctx.rentalHouses.map((h) => `- ${h}`).join("\n") : "(none yet)";
  const catalog = ctx.catalog.length ? ctx.catalog.map((c) => `- ${c}`).join("\n") : "(empty)";
  return `The user uploaded this as a ${ctx.expectedKind === "delivery_note" ? "delivery note" : "return note"}.

Known rental houses (name; aliases):
${houses}

Equipment catalog (name; aliases):
${catalog}

Extract the document.`;
}

/** Normalize photos (rotation, size) so pages are legible and within image limits. */
async function imageBlock(file: ExtractionInputFile): Promise<Anthropic.Beta.BetaImageBlockParam> {
  const jpeg = await sharp(file.bytes).rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } };
}

export class ClaudeDocumentExtractor implements DocumentExtractor {
  readonly provider = "anthropic";
  readonly available = true;
  private readonly client: Anthropic;

  constructor(
    readonly model: string,
    private readonly effort: "low" | "medium" | "high" | "xhigh" | "max",
    client?: Anthropic,
  ) {
    this.client = client ?? new Anthropic();
  }

  async extract(files: ExtractionInputFile[], ctx: ExtractionContext): Promise<ExtractionResult> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const f of files) {
      if (f.mimeType === "application/pdf") {
        content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.bytes.toString("base64") }, title: f.name });
      } else if (f.mimeType.startsWith("image/")) {
        content.push(await imageBlock(f));
      }
    }
    if (content.length === 0) throw new ExtractionError("No readable file (PDF or image) in this document.", false);
    content.push({ type: "text", text: contextBlock(ctx) });

    let message;
    try {
      const stream = this.client.beta.messages.stream({
        model: this.model,
        max_tokens: 64000,
        betas: ["server-side-fallback-2026-07-01"],
        // On a safety-classifier decline the API retries on Anthropic's recommended fallback model.
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: this.effort, format: { type: formatType, schema: outputSchema } },
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
      });
      message = await stream.finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new ExtractionError("The Anthropic API key is invalid. Check ANTHROPIC_API_KEY.", false);
      if (err instanceof Anthropic.RateLimitError) throw new ExtractionError("The AI service is busy (rate limit). Try again in a minute.", true);
      if (err instanceof Anthropic.BadRequestError) throw new ExtractionError(`The AI service rejected the document: ${err.message}`, false);
      if (err instanceof Anthropic.APIError) throw new ExtractionError(`AI service error (${err.status ?? "network"}). Try again.`, true);
      throw err;
    }

    if (message.stop_reason === "refusal") {
      throw new ExtractionError("The AI declined to read this document. Enter the lines manually.", false);
    }
    if (message.stop_reason === "max_tokens") {
      throw new ExtractionError("The document is too long to read in one go. Split it into smaller uploads.", false);
    }
    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    let parsed;
    try {
      parsed = extractionSchema.parse(JSON.parse(text));
    } catch {
      throw new ExtractionError("The AI response could not be read. Try again.", true);
    }
    return {
      extraction: parsed,
      provider: this.provider,
      model: message.model,
      meta: {
        stopReason: message.stop_reason,
        usage: message.usage,
        servedByFallback: (message.usage.iterations ?? []).some((i) => i.type === "fallback_message"),
      },
    };
  }
}
