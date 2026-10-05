/**
 * Delivery notes (and, in Phase 6, return notes): upload -> AI reading -> matching ->
 * human review -> confirmation. Inventory changes only in confirmDelivery().
 */
import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import { ExtractionError, type DocumentExtractor, type Extraction } from "../ai/types";
import type { StorageProvider } from "../storage";
import { recordEvent } from "./audit";
import { DomainError, notFound, pgErrorOf, requireRole, type Ctx } from "./context";
import { expandExtractedLines, findRentalHouse, matchLine, type MatchContext, type ProposedLine } from "./document-matching";
import { ensureProjectRentalHouse, itemLabel, lockItem } from "./equipment-items";
import { expandReturnLines, loadProjectItems, matchReturnLines, type ReturnLine } from "./return-matching";
import { optionalDate, optionalText, optionalUuid } from "./validation";

export const MAX_DOCUMENT_FILES = 20;
export const MAX_DOCUMENT_FILE_BYTES = 25 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export interface UploadedDocumentFile {
  name: string;
  type: string;
  bytes: Buffer;
}

type DocumentKind = "delivery_note" | "return_note";

function safeName(name: string) {
  const base = name.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "").slice(-80);
  return base || "file";
}

/** Sniff the real type from magic bytes; browsers sometimes send application/octet-stream. */
function detectType(f: UploadedDocumentFile) {
  const b = f.bytes;
  if (b.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (b.subarray(4, 12).toString("latin1").startsWith("ftyphei") || b.subarray(4, 12).toString("latin1").startsWith("ftypmif")) return "image/heic";
  return f.type;
}

/** System/AI events have no user actor. */
async function recordAiEvent(tx: DbOrTx, workspaceId: string, e: Omit<typeof s.auditEvent.$inferInsert, "workspaceId" | "actorType" | "actorUserId">) {
  await tx.insert(s.auditEvent).values({ ...e, workspaceId, actorType: "ai", actorUserId: null });
}

async function lockDocument(tx: DbOrTx, ctx: Ctx, id: string) {
  const [d] = await tx
    .select()
    .from(s.document)
    .where(and(eq(s.document.id, id), eq(s.document.workspaceId, ctx.workspaceId)))
    .for("update");
  if (!d) notFound("Document");
  return d;
}

function assertEditable(d: { status: string }) {
  if (d.status === "confirmed") throw new DomainError("VALIDATION", "This document is already confirmed and can no longer be changed.");
  if (d.status === "discarded") throw new DomainError("VALIDATION", "This document was discarded.");
  if (d.status === "processing") throw new DomainError("VALIDATION", "The document is still being read. Wait a moment.");
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export const uploadInput = z.object({
  kind: z.enum(["delivery_note", "return_note"]),
  projectId: z.uuid("Choose a project"),
  rentalHouseId: optionalUuid,
});

/**
 * Store the uploaded files and create the document. Returns whether AI reading
 * should be started (the caller schedules runExtraction after the response).
 */
export async function createDocumentFromUpload(
  db: DbOrTx,
  storage: StorageProvider,
  ctx: Ctx,
  extractor: DocumentExtractor,
  input: z.input<typeof uploadInput>,
  files: UploadedDocumentFile[],
) {
  requireRole(ctx, "member");
  const data = uploadInput.parse(input);
  if (files.length === 0) throw new DomainError("VALIDATION", "Add the PDF or photos of the document.");
  if (files.length > MAX_DOCUMENT_FILES) throw new DomainError("VALIDATION", `At most ${MAX_DOCUMENT_FILES} files per document.`);
  const prepared = files.map((f) => {
    const mimeType = detectType(f);
    if (!ACCEPTED_TYPES.has(mimeType)) throw new DomainError("VALIDATION", `${f.name}: use PDF, JPEG, PNG or WebP.`);
    if (f.bytes.length === 0) throw new DomainError("VALIDATION", `${f.name} is empty.`);
    if (f.bytes.length > MAX_DOCUMENT_FILE_BYTES) throw new DomainError("VALIDATION", `${f.name} is larger than 25 MB.`);
    return { ...f, mimeType, sha256: createHash("sha256").update(f.bytes).digest("hex") };
  });

  const [project] = await db.select().from(s.project).where(and(eq(s.project.id, data.projectId), eq(s.project.workspaceId, ctx.workspaceId)));
  if (!project) notFound("Project");
  if (project.status === "closed") throw new DomainError("VALIDATION", `Project ${project.name} is closed.`);
  if (data.rentalHouseId) {
    const [rh] = await db.select({ id: s.rentalHouse.id }).from(s.rentalHouse).where(and(eq(s.rentalHouse.id, data.rentalHouseId), eq(s.rentalHouse.workspaceId, ctx.workspaceId)));
    if (!rh) notFound("Rental house");
  }

  // Same file uploaded before? Warn (never block: re-scans and corrections happen).
  const [dup] = await db
    .select({ documentId: s.documentFile.documentId })
    .from(s.documentFile)
    .innerJoin(s.document, eq(s.document.id, s.documentFile.documentId))
    .where(and(eq(s.documentFile.workspaceId, ctx.workspaceId), inArray(s.documentFile.sha256, prepared.map((p) => p.sha256)), ne(s.document.status, "discarded")))
    .limit(1);

  const id = randomUUID();
  const keys: string[] = [];
  try {
    for (const [i, f] of prepared.entries()) {
      const key = `w/${ctx.workspaceId}/documents/${id}/${String(i + 1).padStart(2, "0")}-${safeName(f.name)}`;
      await storage.put(key, f.bytes, f.mimeType);
      keys.push(key);
    }
    return await db.transaction(async (tx) => {
      const status = extractor.available ? "processing" : "uploaded";
      const [doc] = await tx
        .insert(s.document)
        .values({
          id,
          workspaceId: ctx.workspaceId,
          kind: data.kind,
          status,
          projectId: project.id,
          rentalHouseId: data.rentalHouseId ?? null,
          title: prepared[0]!.name,
          uploadedById: ctx.userId,
          possibleDuplicateOfId: dup?.documentId ?? null,
          extractionProvider: extractor.provider,
          extractionModel: extractor.available ? extractor.model : null,
        })
        .returning();
      await tx.insert(s.documentFile).values(
        prepared.map((f, i) => ({
          workspaceId: ctx.workspaceId,
          documentId: id,
          storageKey: keys[i]!,
          fileName: f.name.slice(0, 200),
          mimeType: f.mimeType,
          sizeBytes: f.bytes.length,
          sha256: f.sha256,
          sortOrder: i,
        })),
      );
      await recordEvent(tx, ctx, {
        action: "document.uploaded",
        entityType: "document",
        entityId: id,
        documentId: id,
        projectId: project.id,
        rentalHouseId: data.rentalHouseId ?? null,
        summary: `${data.kind === "delivery_note" ? "Delivery note" : "Return note"} uploaded (${prepared.length} file${prepared.length === 1 ? "" : "s"})`,
        metadata: { files: prepared.map((p) => p.name), possibleDuplicateOf: dup?.documentId ?? null },
      });
      return { document: doc!, startExtraction: extractor.available };
    });
  } catch (err) {
    await Promise.allSettled(keys.map((k) => storage.delete(k)));
    throw err;
  }
}

// ---------------------------------------------------------------------------
// AI reading (runs after the upload response; no user session)
// ---------------------------------------------------------------------------

async function extractionContext(db: DbOrTx, ws: string, kind: DocumentKind) {
  const [houses, types] = await Promise.all([
    db.select({ name: s.rentalHouse.name, aliases: s.rentalHouse.aliases }).from(s.rentalHouse).where(and(eq(s.rentalHouse.workspaceId, ws), isNull(s.rentalHouse.archivedAt))).orderBy(asc(s.rentalHouse.name)),
    db
      .select({ name: s.equipmentType.name, aliases: s.equipmentType.aliases })
      .from(s.equipmentType)
      .where(and(eq(s.equipmentType.workspaceId, ws), isNull(s.equipmentType.archivedAt)))
      .orderBy(asc(s.equipmentType.name))
      .limit(2000),
  ]);
  const fmt = (r: { name: string; aliases: string[] }) => (r.aliases.length ? `${r.name}; ${r.aliases.join("; ")}` : r.name);
  return { expectedKind: kind, rentalHouses: houses.map(fmt), catalog: types.map(fmt) };
}

/** Match all proposed lines against the inventory and replace the document's lines. */
async function storeLines(tx: DbOrTx, doc: typeof s.document.$inferSelect, input: ProposedLine[]) {
  await tx.delete(s.documentLine).where(eq(s.documentLine.documentId, doc.id));
  let lines = input;
  let matches;
  if (doc.kind === "return_note") {
    lines = await expandReturnLines(tx, doc.workspaceId, input);
    matches = await matchReturnLines(tx, doc, lines.map((l) => ({ ...l, ignored: false, chosenItemId: null, chosenTypeId: null })));
  } else {
    const mctx: MatchContext = { workspaceId: doc.workspaceId, projectId: doc.projectId, rentalHouseId: doc.rentalHouseId, kind: doc.kind };
    const seen = new Set<string>();
    matches = [];
    for (const line of lines) matches.push(await matchLine(tx, mctx, line, { seenSerials: seen }));
  }
  for (const [i, line] of lines.entries()) {
    await tx.insert(s.documentLine).values({
      workspaceId: doc.workspaceId,
      documentId: doc.id,
      lineNumber: i + 1,
      rawText: line.rawText,
      description: line.description.slice(0, 500),
      manufacturer: line.manufacturer,
      model: line.model,
      quantity: line.quantity,
      serialNumber: line.serialNumber,
      assetNumber: line.assetNumber,
      aiConfidence: line.aiConfidence,
      ...matches[i]!,
    });
  }
}

const isIsoDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);

/**
 * Read a document with the AI provider and store the proposals. Safe to retry:
 * it replaces earlier proposals and never touches inventory.
 */
export async function runExtraction(db: DbOrTx, storage: StorageProvider, extractor: DocumentExtractor, workspaceId: string, documentId: string) {
  const [doc] = await db.select().from(s.document).where(and(eq(s.document.id, documentId), eq(s.document.workspaceId, workspaceId)));
  if (!doc || doc.status !== "processing") return;
  try {
    const files = await db.select().from(s.documentFile).where(eq(s.documentFile.documentId, documentId)).orderBy(asc(s.documentFile.sortOrder));
    const inputs = [];
    for (const f of files) {
      const obj = await storage.get(f.storageKey);
      if (!obj) throw new ExtractionError(`File ${f.fileName} is missing from storage.`, false);
      inputs.push({ name: f.fileName, mimeType: f.mimeType, bytes: obj.body });
    }
    const result = await extractor.extract(inputs, await extractionContext(db, workspaceId, doc.kind as DocumentKind));
    const ex: Extraction = result.extraction;
    const rentalHouseId = doc.rentalHouseId ?? (await findRentalHouse(db, workspaceId, ex.rental_house_name, ex.rental_house_match));
    const documentNumber = ex.document_number?.trim().slice(0, 100) || null;
    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(s.document).where(eq(s.document.id, documentId)).for("update");
      if (!current || current.status !== "processing") return; // discarded meanwhile
      // Same rental house + number already imported? Flag it for the reviewer.
      let duplicateOf = current.possibleDuplicateOfId;
      if (!duplicateOf && documentNumber && rentalHouseId) {
        const [same] = await tx
          .select({ id: s.document.id })
          .from(s.document)
          .where(
            and(
              eq(s.document.workspaceId, workspaceId),
              eq(s.document.kind, current.kind),
              eq(s.document.rentalHouseId, rentalHouseId),
              sql`upper(${s.document.documentNumber}) = upper(${documentNumber})`,
              ne(s.document.id, documentId),
              ne(s.document.status, "discarded"),
            ),
          )
          .limit(1);
        duplicateOf = same?.id ?? null;
      }
      const [updated] = await tx
        .update(s.document)
        .set({
          status: "extracted",
          rentalHouseId,
          documentNumber: current.documentNumber ?? documentNumber,
          documentDate: current.documentDate ?? isIsoDate(ex.document_date),
          extraction: { ...ex, _meta: result.meta } as unknown as Record<string, unknown>,
          extractionProvider: result.provider,
          extractionModel: result.model,
          extractionError: null,
          extractedAt: new Date(),
          possibleDuplicateOfId: duplicateOf,
        })
        .where(eq(s.document.id, documentId))
        .returning();
      await storeLines(tx, updated!, expandExtractedLines(ex.lines));
      await recordAiEvent(tx, workspaceId, {
        action: "document.extracted",
        entityType: "document",
        entityId: documentId,
        documentId,
        projectId: updated!.projectId,
        rentalHouseId,
        summary: `Document ${documentNumber ?? ""} read by AI: ${ex.lines.length} line${ex.lines.length === 1 ? "" : "s"}`.replace("  ", " "),
        metadata: { provider: result.provider, model: result.model, warnings: ex.warnings, servedByFallback: result.meta.servedByFallback ?? false },
      });
    });
  } catch (err) {
    const message = err instanceof ExtractionError ? err.message : "Reading the document failed unexpectedly. Try again or enter the lines manually.";
    if (!(err instanceof ExtractionError)) console.error("extraction failed", err);
    await db
      .update(s.document)
      .set({ status: "failed", extractionError: message })
      .where(and(eq(s.document.id, documentId), eq(s.document.status, "processing")));
  }
}

/** Put a failed/manual document back into the AI queue. Caller schedules runExtraction. */
export async function requestExtraction(db: DbOrTx, ctx: Ctx, extractor: DocumentExtractor, id: string) {
  requireRole(ctx, "member");
  if (!extractor.available) throw new DomainError("VALIDATION", "AI reading is not configured on this server.");
  return db.transaction(async (tx) => {
    const d = await lockDocument(tx, ctx, id);
    if (!["failed", "uploaded", "extracted"].includes(d.status)) throw new DomainError("VALIDATION", "This document cannot be read again.");
    await tx.update(s.document).set({ status: "processing", extractionError: null }).where(eq(s.document.id, id));
  });
}

/** Documents stuck in "processing" (server restarted mid-read) become retryable. */
export async function releaseStaleExtractions(db: DbOrTx, olderThanMinutes = 15) {
  await db
    .update(s.document)
    .set({ status: "failed", extractionError: "Reading was interrupted. Try again." })
    .where(and(eq(s.document.status, "processing"), sql`${s.document.updatedAt} < now() - make_interval(mins => ${olderThanMinutes})`));
}

// ---------------------------------------------------------------------------
// Review: header and lines
// ---------------------------------------------------------------------------

export const headerInput = z.object({
  projectId: z.uuid("Choose a project"),
  rentalHouseId: optionalUuid,
  documentNumber: optionalText(100),
  documentDate: optionalDate,
});

/** Re-run matching for every line, keeping the reviewer's explicit choices. */
async function rematchAll(tx: DbOrTx, doc: typeof s.document.$inferSelect) {
  const lines = await tx.select().from(s.documentLine).where(eq(s.documentLine.documentId, doc.id)).orderBy(asc(s.documentLine.lineNumber));
  if (doc.kind === "return_note") {
    const results = await matchReturnLines(tx, doc, lines.map(toReturnLine));
    for (const [i, l] of lines.entries()) await tx.update(s.documentLine).set(results[i]!).where(eq(s.documentLine.id, l.id));
    return;
  }
  const mctx: MatchContext = { workspaceId: doc.workspaceId, projectId: doc.projectId, rentalHouseId: doc.rentalHouseId, kind: doc.kind };
  const seen = new Set<string>();
  for (const l of lines) {
    if (l.resolution === "ignore") continue;
    // Keep a type that was chosen by the reviewer or matched confidently before (e.g. AI catalog match).
    const keepType = l.reviewerChoice || l.resolution === "create_new" ? l.matchedEquipmentTypeId : null;
    const m = await matchLine(tx, mctx, toProposed(l), { seenSerials: seen, forcedTypeId: keepType });
    await tx.update(s.documentLine).set(m).where(eq(s.documentLine.id, l.id));
  }
}

function toReturnLine(l: typeof s.documentLine.$inferSelect): ReturnLine {
  return {
    ...toProposed(l),
    ignored: l.resolution === "ignore",
    chosenItemId: l.reviewerChoice ? l.matchedEquipmentItemId : null,
    chosenTypeId: l.reviewerChoice ? l.matchedEquipmentTypeId : null,
    hintTypeId: l.resolution === "match_existing" || l.resolution === "pending" ? l.matchedEquipmentTypeId : null,
  };
}

function toProposed(l: typeof s.documentLine.$inferSelect): ProposedLine {
  return {
    rawText: l.rawText,
    description: l.description,
    manufacturer: l.manufacturer,
    model: l.model,
    quantity: l.quantity,
    serialNumber: l.serialNumber,
    assetNumber: l.assetNumber,
    aiConfidence: l.aiConfidence,
    catalogMatch: null,
    isEquipment: true,
  };
}

export async function updateDocumentHeader(db: DbOrTx, ctx: Ctx, id: string, input: z.input<typeof headerInput>) {
  requireRole(ctx, "member");
  const data = headerInput.parse(input);
  return db.transaction(async (tx) => {
    const d = await lockDocument(tx, ctx, id);
    assertEditable(d);
    const [project] = await tx.select().from(s.project).where(and(eq(s.project.id, data.projectId), eq(s.project.workspaceId, ctx.workspaceId)));
    if (!project) notFound("Project");
    if (data.rentalHouseId) {
      const [rh] = await tx.select({ id: s.rentalHouse.id }).from(s.rentalHouse).where(and(eq(s.rentalHouse.id, data.rentalHouseId), eq(s.rentalHouse.workspaceId, ctx.workspaceId)));
      if (!rh) notFound("Rental house");
    }
    const [updated] = await tx
      .update(s.document)
      .set({ projectId: project.id, rentalHouseId: data.rentalHouseId ?? null, documentNumber: data.documentNumber ?? null, documentDate: data.documentDate ?? null })
      .where(eq(s.document.id, id))
      .returning();
    if (updated!.projectId !== d.projectId || updated!.rentalHouseId !== d.rentalHouseId) await rematchAll(tx, updated!);
    return updated!;
  });
}

export const lineInput = z.object({
  description: z.string().trim().min(1, "Required").max(500),
  quantity: z.coerce.number().int().min(1, "At least 1").max(10000),
  serialNumber: optionalText(100),
  assetNumber: optionalText(100),
  equipmentTypeId: optionalUuid,
  /** Return notes: the exact item on the project this line returns. */
  equipmentItemId: optionalUuid,
  ignore: z.preprocess((v) => v === "1" || v === "on" || v === true, z.boolean()).default(false),
});

/** Save a reviewer's edit of one line and re-run matching. */
export async function updateLine(db: DbOrTx, ctx: Ctx, lineId: string, input: z.input<typeof lineInput>) {
  requireRole(ctx, "member");
  const data = lineInput.parse(input);
  return db.transaction(async (tx) => {
    const [line] = await tx.select().from(s.documentLine).where(and(eq(s.documentLine.id, lineId), eq(s.documentLine.workspaceId, ctx.workspaceId))).for("update");
    if (!line) notFound("Line");
    const doc = await lockDocument(tx, ctx, line.documentId);
    assertEditable(doc);
    if (data.equipmentTypeId) {
      const [t] = await tx.select({ id: s.equipmentType.id }).from(s.equipmentType).where(and(eq(s.equipmentType.id, data.equipmentTypeId), eq(s.equipmentType.workspaceId, ctx.workspaceId)));
      if (!t) notFound("Equipment type");
    }
    let chosenTypeId = data.equipmentTypeId ?? null;
    if (data.equipmentItemId) {
      const [it] = await tx.select({ typeId: s.equipmentItem.equipmentTypeId }).from(s.equipmentItem).where(and(eq(s.equipmentItem.id, data.equipmentItemId), eq(s.equipmentItem.workspaceId, ctx.workspaceId)));
      if (!it) notFound("Equipment item");
      chosenTypeId = it.typeId;
    }
    const fields = {
      description: data.description,
      quantity: data.quantity,
      serialNumber: data.serialNumber ?? null,
      assetNumber: data.assetNumber ?? null,
      reviewerChoice: Boolean(data.equipmentTypeId || data.equipmentItemId),
    };

    if (doc.kind === "return_note") {
      // Lines compete for the same project items, so re-match the whole note.
      await tx
        .update(s.documentLine)
        .set({
          ...fields,
          matchedEquipmentTypeId: chosenTypeId ?? (fields.reviewerChoice ? null : line.matchedEquipmentTypeId),
          matchedEquipmentItemId: data.equipmentItemId ?? null,
          resolution: data.ignore ? "ignore" : "pending",
        })
        .where(eq(s.documentLine.id, lineId));
      await rematchAll(tx, doc);
      const [updated] = await tx.select().from(s.documentLine).where(eq(s.documentLine.id, lineId));
      return updated!;
    }

    const proposed: ProposedLine = { ...toProposed(line), ...fields };
    // Serials already used by other lines of this document.
    const others = await tx
      .select({ serial: s.documentLine.serialNumber })
      .from(s.documentLine)
      .where(and(eq(s.documentLine.documentId, doc.id), ne(s.documentLine.id, lineId), ne(s.documentLine.resolution, "ignore")));
    const seen = new Set(others.map((o) => o.serial?.toUpperCase().replace(/[^A-Z0-9]/g, "")).filter((x): x is string => Boolean(x)));
    const m = data.ignore
      ? { matchedEquipmentTypeId: chosenTypeId ?? line.matchedEquipmentTypeId, matchedEquipmentItemId: null, matchConfidence: null, matchReason: "ignored by reviewer", resolution: "ignore" as const }
      : await matchLine(tx, { workspaceId: doc.workspaceId, projectId: doc.projectId, rentalHouseId: doc.rentalHouseId, kind: doc.kind }, proposed, { forcedTypeId: chosenTypeId, seenSerials: seen });
    const [updated] = await tx
      .update(s.documentLine)
      .set({ ...fields, ...m })
      .where(eq(s.documentLine.id, lineId))
      .returning();
    return updated!;
  });
}

export async function addLine(db: DbOrTx, ctx: Ctx, documentId: string, input: z.input<typeof lineInput>) {
  requireRole(ctx, "member");
  const data = lineInput.parse(input);
  return db.transaction(async (tx) => {
    const doc = await lockDocument(tx, ctx, documentId);
    assertEditable(doc);
    const [{ next }] = (await tx.execute<{ next: number }>(sql`SELECT coalesce(max(line_number) + 1, 1)::int AS next FROM document_line WHERE document_id = ${documentId}`)) as unknown as [{ next: number }];
    const [line] = await tx
      .insert(s.documentLine)
      .values({ workspaceId: ctx.workspaceId, documentId, lineNumber: next, description: data.description, quantity: data.quantity, resolution: "pending" })
      .returning();
    return line!;
  }).then((line) => updateLine(db, ctx, line.id, input));
}

export async function removeLine(db: DbOrTx, ctx: Ctx, lineId: string) {
  requireRole(ctx, "member");
  return db.transaction(async (tx) => {
    const [line] = await tx.select().from(s.documentLine).where(and(eq(s.documentLine.id, lineId), eq(s.documentLine.workspaceId, ctx.workspaceId)));
    if (!line) notFound("Line");
    assertEditable(await lockDocument(tx, ctx, line.documentId));
    await tx.delete(s.documentLine).where(eq(s.documentLine.id, lineId));
  });
}

export async function discardDocument(db: DbOrTx, ctx: Ctx, id: string, reason: string | null) {
  requireRole(ctx, "member");
  return db.transaction(async (tx) => {
    const d = await lockDocument(tx, ctx, id);
    if (d.status === "confirmed") throw new DomainError("VALIDATION", "Confirmed documents cannot be discarded; their history must stay intact.");
    if (d.status === "discarded") return d;
    const [updated] = await tx.update(s.document).set({ status: "discarded" }).where(eq(s.document.id, id)).returning();
    await recordEvent(tx, ctx, {
      action: "document.discarded",
      entityType: "document",
      entityId: id,
      documentId: id,
      projectId: d.projectId,
      summary: `${d.kind === "delivery_note" ? "Delivery note" : "Return note"} ${d.documentNumber ?? ""} discarded`.replace("  ", " "),
      metadata: reason ? { reason } : null,
    });
    return updated!;
  });
}

// ---------------------------------------------------------------------------
// Confirmation: the only place a delivery note changes inventory
// ---------------------------------------------------------------------------

export interface ConfirmBlocker {
  lineId?: string;
  message: string;
}

export function documentBlockers(
  doc: { kind: string; projectId: string | null; rentalHouseId: string | null; status: string },
  lines: { id: string; lineNumber: number; resolution: string; matchReason: string | null; matchedEquipmentTypeId: string | null }[],
): ConfirmBlocker[] {
  const out: ConfirmBlocker[] = [];
  const isReturn = doc.kind === "return_note";
  if (!doc.projectId) out.push({ message: "Choose the project." });
  if (!doc.rentalHouseId) out.push({ message: isReturn ? "Choose the rental house the equipment goes back to." : "Choose the rental house that delivered the equipment." });
  if (lines.filter((l) => l.resolution !== "ignore").length === 0) out.push({ message: "There are no equipment lines to confirm." });
  for (const l of lines) {
    if (l.resolution === "pending") out.push({ lineId: l.id, message: `Line ${l.lineNumber}: ${isReturn ? "choose the item that is returned" : "choose the equipment type"} (or ignore the line).` });
    if (l.resolution === "discrepancy") out.push({ lineId: l.id, message: `Line ${l.lineNumber}: ${l.matchReason ?? "resolve the conflict"} — fix it or ignore the line.` });
  }
  return out;
}

/**
 * Apply a reviewed delivery note: reuse known items, create new ones, put all of
 * them on the project with the rental house, link the document, write history.
 */
export async function confirmDelivery(db: DbOrTx, ctx: Ctx, id: string) {
  requireRole(ctx, "member");
  const correlationId = randomUUID();
  return db.transaction(async (tx) => {
    const doc = await lockDocument(tx, ctx, id);
    if (doc.kind !== "delivery_note") throw new DomainError("VALIDATION", "Only delivery notes can be confirmed here.");
    assertEditable(doc);
    // Re-check every line against the current inventory: things may have changed since review.
    await rematchAll(tx, doc);
    const lines = await tx.select().from(s.documentLine).where(eq(s.documentLine.documentId, id)).orderBy(asc(s.documentLine.lineNumber));
    const blockers = documentBlockers(doc, lines);
    if (blockers.length) throw new DomainError("VALIDATION", blockers[0]!.message, { blockers });
    const [project] = await tx.select().from(s.project).where(eq(s.project.id, doc.projectId!));
    if (!project || project.status === "closed") throw new DomainError("VALIDATION", "The project is closed.");
    const rentalHouseId = doc.rentalHouseId!;
    const now = new Date();
    let received = 0;

    const assign = async (itemId: string, label: string, quantity: number, from: string | null) => {
      await tx.insert(s.projectAssignment).values({
        workspaceId: ctx.workspaceId,
        equipmentItemId: itemId,
        projectId: project.id,
        rentalHouseId,
        quantity,
        deliveryDocumentId: id,
        assignedAt: now,
        assignedById: ctx.userId,
      });
      await recordEvent(tx, ctx, {
        action: "equipment_item.assigned_to_project",
        entityType: "equipment_item",
        entityId: itemId,
        equipmentItemId: itemId,
        projectId: project.id,
        documentId: id,
        rentalHouseId,
        summary: `${label} received on ${project.name}`,
        changes: { status: { from, to: "on_project" }, project_id: { from: null, to: project.id } },
        correlationId,
      });
      received += quantity;
    };

    for (const l of lines) {
      if (l.resolution === "ignore") continue;
      if (l.resolution === "match_existing") {
        const item = await lockItem(tx, ctx, l.matchedEquipmentItemId!);
        await tx
          .update(s.equipmentItem)
          .set({ projectId: project.id, caseId: null, status: "on_project", rentalHouseId: item.rentalHouseId ?? rentalHouseId, version: sql`${s.equipmentItem.version} + 1` })
          .where(eq(s.equipmentItem.id, item.id));
        await assign(item.id, item.label, item.quantity, item.status);
        continue;
      }
      // create_new
      const [type] = await tx.select().from(s.equipmentType).where(and(eq(s.equipmentType.id, l.matchedEquipmentTypeId!), eq(s.equipmentType.workspaceId, ctx.workspaceId)));
      if (!type) notFound("Equipment type");
      const bulk = type.defaultTrackingMode === "bulk";
      const units = bulk ? [l.quantity] : Array.from({ length: l.quantity }, () => 1);
      for (const [i, qty] of units.entries()) {
        let item: typeof s.equipmentItem.$inferSelect;
        try {
          item = await tx.transaction(async (sp) => {
            const [row] = await sp
              .insert(s.equipmentItem)
              .values({
                workspaceId: ctx.workspaceId,
                equipmentTypeId: type.id,
                trackingMode: bulk ? "bulk" : "serialized",
                quantity: qty,
                serialNumber: i === 0 ? l.serialNumber : null,
                assetNumber: i === 0 ? l.assetNumber : null,
                rentalHouseId,
                projectId: project.id,
                status: "on_project",
                condition: "ok",
              })
              .returning();
            return row!;
          });
        } catch (err) {
          if (pgErrorOf(err)?.code === "23505") {
            throw new DomainError("CONFLICT", `Line ${l.lineNumber}: serial or asset number already exists. Reload the document to re-check.`, { lineId: l.id });
          }
          throw err;
        }
        const label = itemLabel({ typeName: type.name, ...item });
        await recordEvent(tx, ctx, {
          action: "equipment_item.created",
          entityType: "equipment_item",
          entityId: item.id,
          equipmentItemId: item.id,
          projectId: project.id,
          documentId: id,
          rentalHouseId,
          summary: `${label} created from delivery note ${doc.documentNumber ?? ""}`.trim(),
          correlationId,
        });
        await assign(item.id, label, qty, null);
        if (i === 0) await tx.update(s.documentLine).set({ matchedEquipmentItemId: item.id }).where(eq(s.documentLine.id, l.id));
      }
    }

    await ensureProjectRentalHouse(tx, ctx, project.id, rentalHouseId);
    await tx.update(s.documentLine).set({ confirmedQuantity: sql`CASE WHEN ${s.documentLine.resolution} = 'ignore' THEN 0 ELSE ${s.documentLine.quantity} END` }).where(eq(s.documentLine.documentId, id));
    const [confirmed] = await tx.update(s.document).set({ status: "confirmed", confirmedAt: now, confirmedById: ctx.userId }).where(eq(s.document.id, id)).returning();
    const [rh] = await tx.select({ name: s.rentalHouse.name }).from(s.rentalHouse).where(eq(s.rentalHouse.id, rentalHouseId));
    await recordEvent(tx, ctx, {
      action: "document.confirmed",
      entityType: "document",
      entityId: id,
      documentId: id,
      projectId: project.id,
      rentalHouseId,
      summary: `Delivery note ${doc.documentNumber ?? ""} confirmed`.replace("  ", " "),
      correlationId,
    });
    await recordEvent(tx, ctx, {
      action: "delivery.imported",
      entityType: "document",
      entityId: id,
      documentId: id,
      projectId: project.id,
      rentalHouseId,
      summary: `Delivery ${doc.documentNumber ?? ""} confirmed: ${received} item${received === 1 ? "" : "s"} received from ${rh?.name ?? "rental house"}`.replace("  ", " "),
      metadata: { lines: lines.length, ignored: lines.filter((l) => l.resolution === "ignore").length },
      correlationId,
    });
    return { document: confirmed!, received };
  });
}

// ---------------------------------------------------------------------------
// Return notes: the only place equipment leaves a project for a rental house
// ---------------------------------------------------------------------------

/**
 * Apply a reviewed return note. Matched items leave the project (status returned,
 * out of their case, assignment closed with the note). Bulk lines that return
 * part of an item split it: the returned units become their own item.
 * Everything not on the note stays on the project - partial returns are normal.
 */
export async function confirmReturn(db: DbOrTx, ctx: Ctx, id: string) {
  requireRole(ctx, "member");
  const correlationId = randomUUID();
  return db.transaction(async (tx) => {
    const doc = await lockDocument(tx, ctx, id);
    if (doc.kind !== "return_note") throw new DomainError("VALIDATION", "Only return notes can be confirmed as a return.");
    assertEditable(doc);
    await rematchAll(tx, doc); // inventory may have changed since the review
    const lines = await tx.select().from(s.documentLine).where(eq(s.documentLine.documentId, id)).orderBy(asc(s.documentLine.lineNumber));
    const blockers = documentBlockers(doc, lines);
    if (blockers.length) throw new DomainError("VALIDATION", blockers[0]!.message, { blockers });
    const [project] = await tx.select().from(s.project).where(eq(s.project.id, doc.projectId!));
    const now = new Date();
    let returned = 0;

    const closeAssignment = async (itemId: string) =>
      tx
        .update(s.projectAssignment)
        .set({ endedAt: now, endedById: ctx.userId, endReason: "returned", returnDocumentId: id })
        .where(and(eq(s.projectAssignment.equipmentItemId, itemId), isNull(s.projectAssignment.endedAt)));

    for (const l of lines) {
      if (l.resolution !== "match_existing") continue;
      const item = await lockItem(tx, ctx, l.matchedEquipmentItemId!);
      if (item.projectId !== project!.id) throw new DomainError("CONFLICT", `Line ${l.lineNumber}: ${item.label} is no longer on this project. Reload the note.`);
      const units = item.trackingMode === "bulk" ? l.quantity : 1;

      if (item.trackingMode === "bulk" && units < item.quantity) {
        // Partial bulk return: keep the rest on the project, split off the returned units.
        await tx.update(s.equipmentItem).set({ quantity: item.quantity - units, version: sql`${s.equipmentItem.version} + 1` }).where(eq(s.equipmentItem.id, item.id));
        await tx.update(s.projectAssignment).set({ quantity: item.quantity - units }).where(and(eq(s.projectAssignment.equipmentItemId, item.id), isNull(s.projectAssignment.endedAt)));
        const [open] = await tx.select().from(s.projectAssignment).where(and(eq(s.projectAssignment.equipmentItemId, item.id), isNull(s.projectAssignment.endedAt)));
        const [split] = await tx
          .insert(s.equipmentItem)
          .values({
            workspaceId: ctx.workspaceId,
            equipmentTypeId: item.equipmentTypeId,
            trackingMode: "bulk",
            quantity: units,
            rentalHouseId: item.rentalHouseId,
            status: "returned",
            condition: item.condition,
            splitFromItemId: item.id,
          })
          .returning();
        await tx.insert(s.projectAssignment).values({
          workspaceId: ctx.workspaceId,
          equipmentItemId: split!.id,
          projectId: project!.id,
          rentalHouseId: item.rentalHouseId,
          quantity: units,
          deliveryDocumentId: open?.deliveryDocumentId ?? null,
          returnDocumentId: id,
          assignedAt: open?.assignedAt ?? now,
          assignedById: open?.assignedById ?? ctx.userId,
          endedAt: now,
          endedById: ctx.userId,
          endReason: "returned",
        });
        await recordEvent(tx, ctx, {
          action: "equipment_item.split",
          entityType: "equipment_item",
          entityId: item.id,
          equipmentItemId: item.id,
          projectId: project!.id,
          documentId: id,
          summary: `${item.typeName}: ${units} of ${item.quantity} split off for return`,
          changes: { quantity: { from: item.quantity, to: item.quantity - units } },
          metadata: { splitItemId: split!.id },
          correlationId,
        });
        await recordEvent(tx, ctx, {
          action: "equipment_item.returned",
          entityType: "equipment_item",
          entityId: split!.id,
          equipmentItemId: split!.id,
          projectId: project!.id,
          documentId: id,
          rentalHouseId: item.rentalHouseId,
          summary: `${item.typeName} × ${units} returned to rental house`,
          changes: { status: { from: item.status, to: "returned" } },
          metadata: { splitFromItemId: item.id },
          correlationId,
        });
        await tx.update(s.documentLine).set({ confirmedQuantity: units }).where(eq(s.documentLine.id, l.id));
        returned += units;
        continue;
      }

      await tx
        .update(s.equipmentItem)
        .set({ projectId: null, caseId: null, status: "returned", version: sql`${s.equipmentItem.version} + 1` })
        .where(eq(s.equipmentItem.id, item.id));
      await closeAssignment(item.id);
      if (item.caseId) {
        await recordEvent(tx, ctx, {
          action: "equipment_item.removed_from_case",
          entityType: "equipment_item",
          entityId: item.id,
          equipmentItemId: item.id,
          caseId: item.caseId,
          projectId: project!.id,
          documentId: id,
          summary: `${item.label} unpacked for return`,
          changes: { case_id: { from: item.caseId, to: null } },
          correlationId,
        });
      }
      await recordEvent(tx, ctx, {
        action: "equipment_item.returned",
        entityType: "equipment_item",
        entityId: item.id,
        equipmentItemId: item.id,
        projectId: project!.id,
        documentId: id,
        rentalHouseId: item.rentalHouseId,
        summary: `${item.label} returned to rental house`,
        changes: { status: { from: item.status, to: "returned" }, project_id: { from: project!.id, to: null } },
        correlationId,
      });
      await tx.update(s.documentLine).set({ confirmedQuantity: item.quantity }).where(eq(s.documentLine.id, l.id));
      returned += item.quantity;
    }

    await tx.update(s.documentLine).set({ confirmedQuantity: 0 }).where(and(eq(s.documentLine.documentId, id), eq(s.documentLine.resolution, "ignore")));
    const [confirmed] = await tx.update(s.document).set({ status: "confirmed", confirmedAt: now, confirmedById: ctx.userId }).where(eq(s.document.id, id)).returning();
    const [{ remaining }] = (await tx.execute<{ remaining: number }>(
      sql`SELECT coalesce(sum(quantity),0)::int AS remaining FROM equipment_item WHERE project_id = ${project!.id} AND rental_house_id = ${doc.rentalHouseId}`,
    )) as unknown as [{ remaining: number }];
    const [rh] = await tx.select({ name: s.rentalHouse.name }).from(s.rentalHouse).where(eq(s.rentalHouse.id, doc.rentalHouseId!));
    await recordEvent(tx, ctx, {
      action: "document.confirmed",
      entityType: "document",
      entityId: id,
      documentId: id,
      projectId: project!.id,
      rentalHouseId: doc.rentalHouseId,
      summary: `Return note ${doc.documentNumber ?? ""} confirmed`.replace("  ", " "),
      correlationId,
    });
    await recordEvent(tx, ctx, {
      action: "return_note.imported",
      entityType: "document",
      entityId: id,
      documentId: id,
      projectId: project!.id,
      rentalHouseId: doc.rentalHouseId,
      summary:
        remaining > 0
          ? `Return ${doc.documentNumber ?? ""}: ${returned} returned to ${rh?.name ?? "rental house"}, ${remaining} still on the project (partial return)`.replace("  ", " ")
          : `Return ${doc.documentNumber ?? ""}: ${returned} returned to ${rh?.name ?? "rental house"} — nothing from them left on the project`.replace("  ", " "),
      metadata: { returned, remaining },
      correlationId,
    });
    return { document: confirmed!, returned, remaining };
  });
}

/** Turn a problem line into an issue (return/delivery mismatch) linked to the note. */
export async function reportLineIssue(db: DbOrTx, ctx: Ctx, lineId: string, note: string | null) {
  requireRole(ctx, "member");
  return db.transaction(async (tx) => {
    const [line] = await tx.select().from(s.documentLine).where(and(eq(s.documentLine.id, lineId), eq(s.documentLine.workspaceId, ctx.workspaceId))).for("update");
    if (!line) notFound("Line");
    const doc = await lockDocument(tx, ctx, line.documentId);
    const isReturn = doc.kind === "return_note";
    const [issue] = await tx
      .insert(s.issue)
      .values({
        workspaceId: ctx.workspaceId,
        type: isReturn ? "return_mismatch" : "delivery_mismatch",
        severity: "medium",
        title: `${isReturn ? "Return" : "Delivery"} note ${doc.documentNumber ?? ""}, line ${line.lineNumber}: ${line.description}`.replace("  ", " ").slice(0, 300),
        description: [line.matchReason, note?.trim()].filter(Boolean).join("\n\n") || null,
        projectId: doc.projectId,
        equipmentItemId: line.matchedEquipmentItemId,
        documentId: doc.id,
        createdById: ctx.userId,
      })
      .returning();
    await recordEvent(tx, ctx, {
      action: "issue.created",
      entityType: "issue",
      entityId: issue!.id,
      issueId: issue!.id,
      projectId: doc.projectId,
      documentId: doc.id,
      equipmentItemId: line.matchedEquipmentItemId,
      summary: `Issue opened: ${issue!.title}`,
    });
    await tx
      .update(s.documentLine)
      .set({ matchReason: `${line.matchReason ?? ""} · issue reported`.replace(/^ · /, "") })
      .where(eq(s.documentLine.id, lineId));
    return issue!;
  });
}

/** Return notes: which equipment from this rental house stays on the project after the note. */
async function returnOverview(db: DbOrTx, doc: typeof s.document.$inferSelect, lines: { resolution: string; matchedEquipmentItemId: string | null; quantity: number }[]) {
  if (doc.kind !== "return_note" || !doc.projectId) return null;
  const items = (await loadProjectItems(db, doc.workspaceId, doc.projectId)).filter((i) => !doc.rentalHouseId || i.rentalHouseId === doc.rentalHouseId);
  const claimed = new Map<string, number>();
  for (const l of lines) if (l.resolution === "match_existing" && l.matchedEquipmentItemId) claimed.set(l.matchedEquipmentItemId, (claimed.get(l.matchedEquipmentItemId) ?? 0) + l.quantity);
  const staying = items
    .map((i) => ({ id: i.id, label: itemLabel(i), typeName: i.typeName, units: i.trackingMode === "bulk" ? i.quantity - (claimed.get(i.id) ?? 0) : claimed.has(i.id) ? 0 : 1 }))
    .filter((i) => i.units > 0);
  const returning = [...claimed.values()].reduce((n, u) => n + u, 0);
  return { staying, returning, onProject: items.reduce((n, i) => n + i.quantity, 0) };
}

/** Items a return line may point at (everything on the project, optionally of one type). */
export async function listReturnableItems(db: DbOrTx, ctx: Ctx, projectId: string) {
  const items = await loadProjectItems(db, ctx.workspaceId, projectId);
  return items.map((i) => ({ id: i.id, equipmentTypeId: i.equipmentTypeId, label: `${itemLabel(i)}${i.rentalHouseName ? ` · ${i.rentalHouseName}` : ""}` }));
}

// ---------------------------------------------------------------------------
// Read model for the review page
// ---------------------------------------------------------------------------

export async function getDocumentReview(db: DbOrTx, ctx: Ctx, id: string) {
  const [row] = await db
    .select({ doc: s.document, projectName: s.project.name, projectStatus: s.project.status, rentalHouseName: s.rentalHouse.name, uploadedBy: s.user.name })
    .from(s.document)
    .leftJoin(s.project, eq(s.project.id, s.document.projectId))
    .leftJoin(s.rentalHouse, eq(s.rentalHouse.id, s.document.rentalHouseId))
    .leftJoin(s.user, eq(s.user.id, s.document.uploadedById))
    .where(and(eq(s.document.id, id), eq(s.document.workspaceId, ctx.workspaceId)));
  if (!row) notFound("Document");
  const [files, lines, duplicate] = await Promise.all([
    db.select().from(s.documentFile).where(eq(s.documentFile.documentId, id)).orderBy(asc(s.documentFile.sortOrder)),
    db
      .select({
        line: s.documentLine,
        typeName: s.equipmentType.name,
        itemSerial: s.equipmentItem.serialNumber,
        itemProjectId: s.equipmentItem.projectId,
        itemStatus: s.equipmentItem.status,
      })
      .from(s.documentLine)
      .leftJoin(s.equipmentType, eq(s.equipmentType.id, s.documentLine.matchedEquipmentTypeId))
      .leftJoin(s.equipmentItem, eq(s.equipmentItem.id, s.documentLine.matchedEquipmentItemId))
      .where(eq(s.documentLine.documentId, id))
      .orderBy(asc(s.documentLine.lineNumber)),
    row.doc.possibleDuplicateOfId
      ? db
          .select({ id: s.document.id, documentNumber: s.document.documentNumber, status: s.document.status, createdAt: s.document.createdAt })
          .from(s.document)
          .where(eq(s.document.id, row.doc.possibleDuplicateOfId))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);
  const flat = lines.map((l) => ({ ...l.line, typeName: l.typeName, itemSerial: l.itemSerial, itemProjectId: l.itemProjectId, itemStatus: l.itemStatus }));
  const overview = row.doc.status === "confirmed" ? null : await returnOverview(db, row.doc, flat);
  const [outcome] =
    row.doc.status === "confirmed"
      ? await db
          .select({ summary: s.auditEvent.summary, occurredAt: s.auditEvent.occurredAt })
          .from(s.auditEvent)
          .where(and(eq(s.auditEvent.documentId, id), inArray(s.auditEvent.action, ["delivery.imported", "return_note.imported"])))
          .orderBy(desc(s.auditEvent.id))
          .limit(1)
      : [];
  const extraction = row.doc.extraction as (Extraction & { _meta?: Record<string, unknown> }) | null;
  return {
    ...row,
    files,
    lines: flat,
    duplicate,
    warnings: extraction?.warnings ?? [],
    blockers: documentBlockers(row.doc, flat),
    returnOverview: overview,
    outcome: outcome ?? null,
    counts: {
      create: flat.filter((l) => l.resolution === "create_new").reduce((n, l) => n + l.quantity, 0),
      existing: flat.filter((l) => l.resolution === "match_existing").length,
      pending: flat.filter((l) => l.resolution === "pending").length,
      discrepancy: flat.filter((l) => l.resolution === "discrepancy").length,
      ignored: flat.filter((l) => l.resolution === "ignore").length,
    },
  };
}

/** Storage key of an uploaded document file for a signed-in member of its workspace. */
export async function getDocumentFileForUser(db: DbOrTx, userId: string, fileId: string) {
  const [row] = await db
    .select({ storageKey: s.documentFile.storageKey, mimeType: s.documentFile.mimeType, fileName: s.documentFile.fileName })
    .from(s.documentFile)
    .innerJoin(s.workspaceMember, and(eq(s.workspaceMember.workspaceId, s.documentFile.workspaceId), eq(s.workspaceMember.userId, userId)))
    .where(eq(s.documentFile.id, fileId));
  return row ?? null;
}
