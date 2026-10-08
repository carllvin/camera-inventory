import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import sharp from "sharp";
import { z } from "zod";
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
/**
 * What the model fills in. Structured output allows only a few nullable / union
 * fields per schema, so here every text is a plain string ("" = not printed),
 * flags are plain booleans, and fromWire() turns blanks back into null.
 */
const blank = z.string();
const wireSchema = extractionSchema.extend({
  rental_house_name: blank,
  rental_house_match: blank,
  document_number: blank,
  document_date: blank,
  project_reference: blank,
  project_number: blank,
  customer_name: blank,
  project_match: blank,
  rental_start_date: blank,
  rental_end_date: blank,
  lines: z.array(
    extractionSchema.shape.lines.element.extend({
      manufacturer: blank,
      model: blank,
      catalog_match: blank,
      is_heading: z.boolean(),
      is_container: z.boolean(),
      set_name: blank,
      suggested_category: blank,
      suggested_tracking: z.enum(["serialized", "bulk", "none"]),
    }),
  ),
});

const BLANK_KEYS = new Set(["rental_house_name", "rental_house_match", "document_number", "document_date", "project_reference", "project_number", "customer_name", "project_match", "rental_start_date", "rental_end_date", "manufacturer", "model", "catalog_match", "set_name", "suggested_category"]);

/** "" → null (and suggested_tracking "none" → null), so the rest of the app sees the usual extraction. */
export function fromWire(raw: unknown): unknown {
  const fix = (o: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(o).map(([k, v]) => [k, (BLANK_KEYS.has(k) && typeof v === "string" && v.trim() === "") || (k === "suggested_tracking" && v === "none") ? null : v]),
    );
  if (!raw || typeof raw !== "object") return raw;
  const doc = fix(raw as Record<string, unknown>);
  if (Array.isArray(doc.lines)) doc.lines = doc.lines.map((l) => (l && typeof l === "object" ? fix(l as Record<string, unknown>) : l));
  return doc;
}

const { type: formatType, schema: outputSchema } = betaZodOutputFormat(wireSchema);
export { outputSchema as extractionOutputSchema };

const SYSTEM_PROMPT = `You read rental paperwork for a film camera department: delivery notes (Lieferschein) and return notes (Rücklieferschein / Retoure) from camera, lens, grip and lighting rental houses. Documents are often German or English, sometimes multi-page, sometimes photographed at an angle.

Extract exactly what is printed. The output is reviewed by a camera assistant before any inventory changes, so a blank field is far better than a guess: never invent serial numbers, asset numbers, quantities or dates. A text field without a value is an empty string "" (below, "empty" means "").

Lines
- One output line per item line on the document, in document order.
- If a line lists several serial numbers, put all of them in serial_numbers (quantity stays as printed).
- Headings are never items: section titles ("Kamera", "Objektive", "Zubehör", "Licht") and set or kit titles that only introduce the components below them ("ALEXA 35 Set", "Kamera-Set A", "Set bestehend aus:") get is_heading: true and is_equipment: false. Output the heading line once, then each listed component as its own line; components without their own quantity have quantity 1 per set.
- is_container: true for transport cases and containers (Koffer, Case, Kiste, Peli, Flightcase, "Koffer f. …") - they hold equipment and become sets; false otherwise. A case that is part of a set gets that set's set_name too.
- set_name: the heading (set, kit or section title) a line is printed under, as printed - e.g. every component under "ALEXA 35 Set", or every line in the section "Objektive"; the heading line itself carries its own text too. Empty for lines that stand under no heading. Use exactly the same text for all lines of one group.
- Mark transport, insurance, deposits, discounts, subtotals, signatures and free-text remarks as is_equipment: false.
- quantity is the number of units delivered/returned on that line (use 1 if no quantity is printed for an item).
- Asset numbers are the rental house's inventory numbers (often labelled Inv.-Nr., Asset, ID, Barcode); serial numbers are manufacturer serials (S/N, SN, Seriennr.).
- catalog_match: if the line is clearly the same product as one entry of the provided equipment catalog, copy that entry exactly (aliases count); otherwise empty. Do not match merely similar products (e.g. a different focal length or a TX vs. RX).
- confidence reflects how certain the reading of that line is (smudged, handwritten or cut-off text lowers it).
- manufacturer / model: the product's maker and model name as a camera assistant would write them (e.g. "ARRI" / "Signature Prime 47mm T1.8"), also when the maker is obvious but not printed; empty if unsure.
- For equipment lines without catalog_match (new products), help the reviewer create them: suggested_category = the best-fitting entry of the provided category list (copy it exactly) or empty; suggested_tracking = "serialized" for devices that carry their own serial number (cameras, lenses, monitors, motors, batteries), "bulk" for interchangeable stock (cables, sandbags, screws, clamps, filters frames), "none" if unsure. Leave suggested_category empty and suggested_tracking "none" for lines with a catalog_match.

Header
- rental_house_name as printed; rental_house_match = exact entry from the provided rental-house list if it is clearly the same company, else empty.
- document_date as YYYY-MM-DD.
- project_reference = the production / film / job title (e.g. "Produktionstitel", "Projekt", "Job"); project_number = the rental house's project, job or order number for the production (e.g. "Projektnummer", "Auftragsnummer", "Job-Nr.") - never the document number; customer_name = the customer / production company the equipment is rented to (not the rental house).
- project_match = exact name from the provided project list if the document is clearly for that production (title, code or customer agree), else empty. Do not match on the customer alone when the customer has several projects.
- rental_start_date / rental_end_date = the printed rental period (pickup / return or "Einsatz von / bis") as YYYY-MM-DD.
- Add a warning for anything a reviewer must check: unreadable parts, handwritten corrections, crossed-out lines, pages that seem to be missing.`;

/** Stable per workspace (rental houses, projects, catalog): first in the message so it can be cached. */
function referenceBlock(ctx: ExtractionContext) {
  const houses = ctx.rentalHouses.length ? ctx.rentalHouses.map((h) => `- ${h}`).join("\n") : "(none yet)";
  const catalog = ctx.catalog.length ? ctx.catalog.map((c) => `- ${c}`).join("\n") : "(empty)";
  const projects = ctx.projects.length ? ctx.projects.map((p) => `- ${p}`).join("\n") : "(none yet)";
  return `Known rental houses (name; aliases):
${houses}

Open projects (name; code; production company):
${projects}

Equipment catalog in use (name; aliases):
${catalog}

Equipment categories:
${(ctx.categories ?? []).map((c) => `- ${c}`).join("\n") || "(none)"}`;
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
    // Reference lists first (cached: repeated uploads within minutes reuse them at a fraction of the price),
    // then the document, then the per-request instruction.
    const content: Anthropic.Beta.BetaContentBlockParam[] = [{ type: "text", text: referenceBlock(ctx), cache_control: { type: "ephemeral" } }];
    for (const f of files) {
      if (f.mimeType === "application/pdf") {
        content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.bytes.toString("base64") }, title: f.name });
      } else if (f.mimeType.startsWith("image/")) {
        content.push(await imageBlock(f));
      }
    }
    if (content.length === 1) throw new ExtractionError("No readable file (PDF or image) in this document.", false);
    content.push({ type: "text", text: `The user uploaded this as a ${ctx.expectedKind === "delivery_note" ? "delivery note" : ctx.expectedKind === "inventory_list" ? "current list of all equipment rented to the production (Mietliste / Bestandsliste)" : "return note"}. Extract the document.` });

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
      parsed = extractionSchema.parse(fromWire(JSON.parse(text)));
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
