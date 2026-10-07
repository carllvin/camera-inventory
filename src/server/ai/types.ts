/**
 * AI provider contracts. Domain code depends only on these interfaces, so the
 * provider (Claude today) can be swapped or mocked without touching business logic.
 * AI output is always a proposal: nothing here writes to the database.
 */
import { z } from "zod";

export const extractedLineSchema = z.object({
  /** Text of the line as printed, for traceability. */
  raw_text: z.string(),
  /** Item description as printed (normalized whitespace). */
  description: z.string(),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  quantity: z.number().int(),
  /** Serial numbers printed for this line (one per physical unit when listed). */
  serial_numbers: z.array(z.string()),
  /** Rental-house inventory / asset numbers printed for this line. */
  asset_numbers: z.array(z.string()),
  /** Exact name from the provided equipment catalog when clearly the same product, else null. */
  catalog_match: z.string().nullable(),
  /** False for non-equipment lines: transport, insurance, deposits, subtotals, notes. */
  is_equipment: z.boolean(),
  /** A heading (section or set title) that only introduces the lines below it - never an item. */
  is_heading: z.boolean().nullable().optional(),
  /** A transport case / container (Koffer, Case, Kiste, Peli, Flightcase) that holds other listed equipment, not equipment itself. */
  is_container: z.boolean().nullable().optional(),
  /** The set / kit this line belongs to by the document's layout (heading with indented or grouped components), e.g. "ALEXA 35 Set"; null if none. */
  set_name: z.string().nullable().optional(),
  /** Equipment without catalog_match: best-fitting category from the provided list (exact text), else null. */
  suggested_category: z.string().nullable().optional(),
  /** Equipment without catalog_match: "serialized" for devices with their own serial, "bulk" for interchangeable stock (cables, sandbags, screws). */
  suggested_tracking: z.string().nullable().optional(),
  /** 0–1: how sure the reading of this line is. */
  confidence: z.number(),
});

export const extractionSchema = z.object({
  document_type: z.enum(["delivery_note", "return_note", "other"]),
  rental_house_name: z.string().nullable(),
  /** Exact name from the provided rental-house list when clearly the same company, else null. */
  rental_house_match: z.string().nullable(),
  document_number: z.string().nullable(),
  /** ISO date (YYYY-MM-DD) of the document, if printed. */
  document_date: z.string().nullable(),
  /** Production title / project / job name printed on the document. */
  project_reference: z.string().nullable(),
  /** The rental house's project / job / order number for this production (not the document number). */
  project_number: z.string().nullable(),
  /** Customer / production company the equipment is rented to. */
  customer_name: z.string().nullable(),
  /** Exact name from the provided project list when clearly the same production, else null. */
  project_match: z.string().nullable(),
  /** Rental period (pickup / return dates) as YYYY-MM-DD, if printed. */
  rental_start_date: z.string().nullable(),
  rental_end_date: z.string().nullable(),
  lines: z.array(extractedLineSchema),
  /** Anything the reviewer should know: unreadable parts, handwritten corrections, missing pages. */
  warnings: z.array(z.string()),
});

export type ExtractedLine = z.infer<typeof extractedLineSchema>;
export type Extraction = z.infer<typeof extractionSchema>;

export interface ExtractionInputFile {
  name: string;
  mimeType: string;
  bytes: Buffer;
}

export interface ExtractionContext {
  /** What the user said they uploaded. */
  expectedKind: "delivery_note" | "return_note" | "inventory_list";
  /** Known rental houses (names + aliases) to help identify the sender. */
  rentalHouses: string[];
  /** Known equipment type names (+ aliases) for normalization. */
  catalog: string[];
  /** Open projects ("name; code; production company") to recognise the production. */
  projects: string[];
  /** Equipment categories ("Camera › Camera Bodies") for suggesting where unknown products belong. */
  categories?: string[];
}

export interface ExtractionResult {
  extraction: Extraction;
  provider: string;
  model: string;
  /** Raw provider metadata kept for traceability (usage, stop reason, fallback info). */
  meta: Record<string, unknown>;
}

export interface DocumentExtractor {
  readonly provider: string;
  readonly model: string;
  /** False when no AI is configured: documents are then entered manually. */
  readonly available: boolean;
  extract(files: ExtractionInputFile[], ctx: ExtractionContext): Promise<ExtractionResult>;
}

/** A provider failure the user should see (refusal, unreadable document, missing key …). */
export class ExtractionError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
    this.name = "ExtractionError";
  }
}
