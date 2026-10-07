/** Phase 5: delivery notes from upload to confirmed inventory, with a fake AI provider. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/server/db/schema";
import { ExtractionError, type DocumentExtractor, type Extraction, type ExtractedLine } from "../src/server/ai/types";
import { ManualExtractor } from "../src/server/ai";
import { DomainError, type Ctx } from "../src/server/domain/context";
import {
  addLine,
  confirmDelivery,
  createDocumentFromUpload,
  discardDocument,
  getDocumentFileForUser,
  getDocumentReview,
  requestExtraction,
  runExtraction,
  updateLine,
  createTypeFromLine,
} from "../src/server/domain/documents";
import { expandExtractedLines } from "../src/server/domain/document-matching";
import { getCaseDetail } from "../src/server/domain/cases";
import { createItem } from "../src/server/domain/equipment-items";
import { createEquipmentType } from "../src/server/domain/equipment-types";
import { createRentalHouse } from "../src/server/domain/rental-houses";
import { LocalStorage } from "../src/server/storage";
import { client, db, itemOnProject, makeFixture, type Fixture } from "./helpers/db";

let dir: string;
let storage: LocalStorage;
let f: Fixture;
let ctx: Ctx;
let teradekTx: { id: string };
let sandbag: { id: string };
let arri: { id: string };

const pdf = (marker: string) => Buffer.from(`%PDF-1.4\n% ${marker}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF`);

function line(p: Partial<ExtractedLine> & { description: string }): ExtractedLine {
  return {
    raw_text: p.description,
    manufacturer: null,
    model: null,
    quantity: 1,
    serial_numbers: [],
    asset_numbers: [],
    catalog_match: null,
    is_equipment: true,
    confidence: 0.9,
    ...p,
  };
}

class FakeExtractor implements DocumentExtractor {
  readonly provider = "fake";
  readonly model = "fake-1";
  readonly available = true;
  calls = 0;
  constructor(private readonly result: Extraction | Error) {}
  async extract() {
    this.calls++;
    if (this.result instanceof Error) throw this.result;
    return { extraction: this.result, provider: this.provider, model: this.model, meta: {} };
  }
}

function extraction(lines: ExtractedLine[], extra: Partial<Extraction> = {}): Extraction {
  return {
    document_type: "delivery_note",
    rental_house_name: "ARRI Rental Deutschland GmbH",
    rental_house_match: null,
    document_number: `LS-${Math.random().toString(36).slice(2, 8)}`,
    document_date: "2026-10-01",
    project_reference: null,
    project_number: null,
    customer_name: null,
    project_match: null,
    rental_start_date: null,
    rental_end_date: null,
    lines,
    warnings: [],
    ...extra,
  };
}

async function upload(extractor: DocumentExtractor, marker = Math.random().toString(36)) {
  const r = await createDocumentFromUpload(db, storage, ctx, extractor, { kind: "delivery_note", projectId: f.project.id }, [{ name: "lieferschein.pdf", type: "application/pdf", bytes: pdf(marker) }]);
  if (r.startExtraction) await runExtraction(db, storage, extractor, ctx.workspaceId, r.document.id);
  return r.document.id;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ci-docs-"));
  storage = new LocalStorage(dir);
  f = await makeFixture();
  ctx = { workspaceId: f.ws.id, userId: f.user.id, role: "owner" };
  arri = await createRentalHouse(db, ctx, { name: "ARRI Rental", aliases: "ARRI Rental Deutschland GmbH" });
  teradekTx = await createEquipmentType(db, ctx, { manufacturer: "Teradek", model: "Bolt 6 XT 750 TX", aliases: "Bolt TX" });
  await createEquipmentType(db, ctx, { manufacturer: "Teradek", model: "Bolt 6 XT 750 RX", aliases: "Bolt RX" });
  sandbag = await createEquipmentType(db, ctx, { manufacturer: "Matthews", model: "Sandbag 15 lb", aliases: "Sandsack", defaultTrackingMode: "bulk" });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await client.end();
});

describe("line expansion", () => {
  it("splits multi-serial lines into one line per unit", () => {
    const out = expandExtractedLines([
      line({ description: "Bolt TX", quantity: 3, serial_numbers: ["TX-1", "TX-2"] }),
      line({ description: "Transport", is_equipment: false }),
    ]);
    expect(out.map((l) => [l.quantity, l.serialNumber])).toEqual([[1, "TX-1"], [1, "TX-2"], [1, null], [1, null]]);
    expect(out[3]!.isEquipment).toBe(false);
  });
});

describe("delivery notes", () => {
  it("reads, matches and proposes lines; history records upload and AI reading", async () => {
    const ex = new FakeExtractor(
      extraction([
        line({ description: "ALEXA 35 Kamera", catalog_match: "ARRI ALEXA 35", serial_numbers: ["DOC-A35-1"] }),
        line({ description: "Teradek Bolt TX", quantity: 2, serial_numbers: ["TDX-1", "TDX-2"], catalog_match: "Bolt TX" }),
        line({ description: "Sandsack 15lb", quantity: 10 }),
        line({ description: "Some unknown widget XYZ-9000" }),
        line({ description: "Transportpauschale", is_equipment: false }),
      ]),
    );
    const id = await upload(ex);
    const r = await getDocumentReview(db, ctx, id);
    expect(r.doc.status).toBe("extracted");
    expect(r.doc.rentalHouseId).toBe(arri.id); // matched via alias
    expect(r.lines.map((l) => [l.description, l.resolution, l.typeName])).toEqual([
      ["ALEXA 35 Kamera", "create_new", "ARRI ALEXA 35"],
      ["Teradek Bolt TX", "create_new", "Teradek Bolt 6 XT 750 TX"],
      ["Teradek Bolt TX", "create_new", "Teradek Bolt 6 XT 750 TX"],
      ["Sandsack 15lb", "create_new", "Matthews Sandbag 15 lb"],
      ["Some unknown widget XYZ-9000", "pending", null],
      ["Transportpauschale", "ignore", null],
    ]);
    expect(r.blockers.map((b) => b.message)).toEqual(["Line 5: choose the equipment type (or ignore the line)."]);
    const events = await db.select().from(s.auditEvent).where(eq(s.auditEvent.documentId, id)).orderBy(s.auditEvent.id);
    expect(events.map((e) => [e.action, e.actorType])).toEqual([
      ["document.uploaded", "user"],
      ["document.extracted", "ai"],
    ]);
    // Nothing on the project changed yet.
    expect(await db.select().from(s.equipmentItem).where(eq(s.equipmentItem.serialNumber, "DOC-A35-1"))).toHaveLength(0);
  });

  it("confirm creates/reuses items, assigns them with the document, and is final", async () => {
    // A camera returned from an earlier job: same serial must be reused, not duplicated.
    const known = await createItem(db, ctx, { equipmentTypeId: f.camType.id, serialNumber: "REUSE-35", rentalHouseId: arri.id });
    const ex = new FakeExtractor(
      extraction([
        line({ description: "ALEXA 35", serial_numbers: ["reuse 35"] }),
        line({ description: "Bolt TX", catalog_match: "Bolt TX", serial_numbers: ["NEW-TX-9"] }),
        line({ description: "Sandsack", catalog_match: "Sandsack", quantity: 12 }),
        line({ description: "Bolt TX ohne Seriennr", catalog_match: "Bolt TX", quantity: 2 }),
      ]),
    );
    const id = await upload(ex);
    const before = await getDocumentReview(db, ctx, id);
    expect(before.lines[0]).toMatchObject({ resolution: "match_existing", matchedEquipmentItemId: known.id });
    const { received } = await confirmDelivery(db, ctx, id);
    expect(received).toBe(1 + 1 + 12 + 2);

    const [reused] = await db.select().from(s.equipmentItem).where(eq(s.equipmentItem.id, known.id));
    expect(reused).toMatchObject({ projectId: f.project.id, status: "on_project" });
    const bags = await db.select().from(s.equipmentItem).where(and(eq(s.equipmentItem.equipmentTypeId, sandbag.id), eq(s.equipmentItem.workspaceId, ctx.workspaceId)));
    expect(bags.map((b) => [b.trackingMode, b.quantity])).toEqual([["bulk", 12]]);
    const txs = await db.select().from(s.equipmentItem).where(and(eq(s.equipmentItem.equipmentTypeId, teradekTx.id), eq(s.equipmentItem.workspaceId, ctx.workspaceId)));
    expect(txs).toHaveLength(3); // NEW-TX-9 + two without serial
    const assignments = await db.select().from(s.projectAssignment).where(eq(s.projectAssignment.deliveryDocumentId, id));
    expect(assignments).toHaveLength(5);
    expect(new Set(assignments.map((a) => a.rentalHouseId))).toEqual(new Set([arri.id]));

    const doc = await getDocumentReview(db, ctx, id);
    expect(doc.doc.status).toBe("confirmed");
    const actions = (await db.select().from(s.auditEvent).where(eq(s.auditEvent.documentId, id))).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["document.confirmed", "delivery.imported", "equipment_item.created", "equipment_item.assigned_to_project"]));
    const correlations = new Set((await db.select().from(s.auditEvent).where(and(eq(s.auditEvent.documentId, id), eq(s.auditEvent.actorType, "user")))).filter((e) => e.action !== "document.uploaded").map((e) => e.correlationId));
    expect(correlations.size).toBe(1);

    await expect(confirmDelivery(db, ctx, id)).rejects.toThrow("already confirmed");
    await expect(discardDocument(db, ctx, id, null)).rejects.toThrow("cannot be discarded");
  });

  it("never moves equipment that is still on another project; reviewer must resolve", async () => {
    await itemOnProject(f, { serialNumber: "BUSY-1", projectId: f.project2.id });
    const ex = new FakeExtractor(extraction([line({ description: "ALEXA 35", serial_numbers: ["BUSY-1"] }), line({ description: "ALEXA 35", serial_numbers: ["DUPL-1"], catalog_match: "ARRI ALEXA 35" }), line({ description: "ALEXA 35 again", serial_numbers: ["DUPL-1"], catalog_match: "ARRI ALEXA 35" })]));
    const id = await upload(ex);
    const r = await getDocumentReview(db, ctx, id);
    expect(r.lines.map((l) => l.resolution)).toEqual(["discrepancy", "create_new", "discrepancy"]);
    expect(r.lines[0]!.matchReason).toContain("still on Project B");
    expect(r.lines[2]!.matchReason).toContain("appears twice");
    const err = await confirmDelivery(db, ctx, id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).details?.blockers).toHaveLength(2);
    // Reviewer ignores both problem lines -> confirm works; the busy item stays where it is.
    for (const l of [r.lines[0]!, r.lines[2]!]) await updateLine(db, ctx, l.id, { description: l.description, quantity: 1, serialNumber: l.serialNumber, ignore: "1" });
    await confirmDelivery(db, ctx, id);
    const [busy] = await db.select().from(s.equipmentItem).where(and(eq(s.equipmentItem.serialNumber, "BUSY-1"), eq(s.equipmentItem.workspaceId, ctx.workspaceId)));
    expect(busy!.projectId).toBe(f.project2.id);
  });

  it("reviewer picks a type for an unknown line and can add lines by hand", async () => {
    const id = await upload(new FakeExtractor(extraction([line({ description: "Zubehörkoffer gross" })])));
    const [pending] = (await getDocumentReview(db, ctx, id)).lines;
    expect(pending!.resolution).toBe("pending");
    await updateLine(db, ctx, pending!.id, { description: "Bolt TX (spare)", quantity: 1, serialNumber: "HAND-TX", equipmentTypeId: teradekTx.id });
    await addLine(db, ctx, id, { description: "Sandbags extra", quantity: 4, equipmentTypeId: sandbag.id });
    const r = await getDocumentReview(db, ctx, id);
    expect(r.lines.map((l) => l.resolution)).toEqual(["create_new", "create_new"]);
    expect(r.blockers).toHaveLength(0);
  });

  it("flags duplicate uploads by file and by document number", async () => {
    const number = "LS-DUP-777";
    const first = await upload(new FakeExtractor(extraction([line({ description: "x", is_equipment: false })], { document_number: number })), "same-file");
    const sameFile = await createDocumentFromUpload(db, storage, ctx, new ManualExtractor(), { kind: "delivery_note", projectId: f.project.id }, [{ name: "again.pdf", type: "application/pdf", bytes: pdf("same-file") }]);
    expect(sameFile.document.possibleDuplicateOfId).toBe(first);
    const sameNumber = await upload(new FakeExtractor(extraction([line({ description: "x", is_equipment: false })], { document_number: number.toLowerCase() })));
    expect((await getDocumentReview(db, ctx, sameNumber)).duplicate?.id).toBe(first);
  });

  it("AI failures leave the document retryable; without AI the lines are entered manually", async () => {
    const failing = new FakeExtractor(new ExtractionError("The AI declined to read this document. Enter the lines manually.", false));
    const id = await upload(failing);
    const r = await getDocumentReview(db, ctx, id);
    expect(r.doc).toMatchObject({ status: "failed", extractionError: "The AI declined to read this document. Enter the lines manually." });
    const ok = new FakeExtractor(extraction([line({ description: "Bolt TX", catalog_match: "Bolt TX" })]));
    await requestExtraction(db, ctx, ok, id);
    await runExtraction(db, storage, ok, ctx.workspaceId, id);
    expect((await getDocumentReview(db, ctx, id)).lines).toHaveLength(1);

    const manual = await upload(new ManualExtractor());
    expect((await getDocumentReview(db, ctx, manual)).doc.status).toBe("uploaded");
    const [mRow] = await db.select().from(s.document).where(eq(s.document.id, manual));
    await expect(confirmDelivery(db, ctx, manual)).rejects.toThrow(); // no rental house, no lines
    await addLine(db, ctx, manual, { description: "Bolt TX", quantity: 1, serialNumber: "MAN-1", equipmentTypeId: teradekTx.id });
    await db.update(s.document).set({ rentalHouseId: arri.id }).where(eq(s.document.id, mRow!.id));
    await confirmDelivery(db, ctx, manual);
  });

  it("rejects non-document files and is isolated per workspace", async () => {
    await expect(
      createDocumentFromUpload(db, storage, ctx, new ManualExtractor(), { kind: "delivery_note", projectId: f.project.id }, [{ name: "notes.txt", type: "text/plain", bytes: Buffer.from("hello") }]),
    ).rejects.toThrow("use PDF");
    const id = await upload(new ManualExtractor());
    const other = await makeFixture();
    const otherCtx: Ctx = { workspaceId: other.ws.id, userId: other.user.id, role: "owner" };
    await expect(getDocumentReview(db, otherCtx, id)).rejects.toThrow("not found");
    await expect(confirmDelivery(db, otherCtx, id)).rejects.toThrow("not found");
    const [file] = await db.select().from(s.documentFile).where(eq(s.documentFile.documentId, id));
    expect(await getDocumentFileForUser(db, other.user.id, file!.id)).toBeNull();
    expect(await getDocumentFileForUser(db, f.user.id, file!.id)).toMatchObject({ mimeType: "application/pdf" });
    await expect(createDocumentFromUpload(db, storage, { ...ctx, role: "viewer" }, new ManualExtractor(), { kind: "delivery_note", projectId: f.project.id }, [{ name: "a.pdf", type: "application/pdf", bytes: pdf("v") }])).rejects.toThrow("permission");
  });
});

describe("unknown products on a delivery note", () => {
  it("one type choice covers every line of the same product and is remembered as an alias", async () => {
    const id = await upload(
      new FakeExtractor(
        extraction([
          line({ description: "Funkstrecke Bolt Sechs Sender", serial_numbers: ["BT-901"] }),
          line({ description: "Funkstrecke Bolt Sechs Sender", serial_numbers: ["BT-902"] }),
          line({ description: "Funkstrecke Bolt Sechs Sender", serial_numbers: ["BT-903"] }),
        ]),
      ),
    );
    let review = await getDocumentReview(db, ctx, id);
    expect(review.lines.map((l) => l.resolution)).toEqual(["pending", "pending", "pending"]);
    const first = review.lines[0]!;
    const r = await updateLine(db, ctx, first.id, { description: first.description, quantity: 1, serialNumber: first.serialNumber, equipmentTypeId: teradekTx.id });
    expect(r.alsoApplied).toBe(2);
    review = await getDocumentReview(db, ctx, id);
    expect(review.lines.map((l) => [l.resolution, l.matchedEquipmentTypeId])).toEqual(Array(3).fill(["create_new", teradekTx.id]));

    const [type] = await db.select().from(s.equipmentType).where(eq(s.equipmentType.id, teradekTx.id));
    expect(type!.aliases).toContain("Funkstrecke Bolt Sechs Sender");
    // The next note with that wording is matched without asking.
    const next = await upload(new FakeExtractor(extraction([line({ description: "Funkstrecke Bolt Sechs Sender", serial_numbers: ["BT-904"] })])));
    expect((await getDocumentReview(db, ctx, next)).lines[0]).toMatchObject({ resolution: "create_new", matchedEquipmentTypeId: teradekTx.id });
  });

  it("creates the missing type in one step with the AI's suggestions and uses it on all its lines", async () => {
    const id = await upload(
      new FakeExtractor(
        extraction([
          line({ description: "Wooden Camera Ultra QR Plate", manufacturer: "Wooden Camera", model: "Ultra QR Plate", serial_numbers: ["WC-1"], suggested_category: "Camera", suggested_tracking: "serialized" }),
          line({ description: "Wooden Camera Ultra QR Plate", manufacturer: "Wooden Camera", model: "Ultra QR Plate", serial_numbers: ["WC-2"], suggested_category: "Camera", suggested_tracking: "serialized" }),
        ]),
      ),
    );
    const review = await getDocumentReview(db, ctx, id);
    expect(review.lines[0]).toMatchObject({ suggestedCategory: "Camera", suggestedTracking: "serialized", resolution: "pending" });
    const r = await createTypeFromLine(db, ctx, review.lines[0]!.id, { manufacturer: "Wooden Camera", model: "Ultra QR Plate", categoryId: f.category.id, tracking: "serialized" });
    expect(r.alsoApplied).toBe(1);
    const after = await getDocumentReview(db, ctx, id);
    expect(after.lines.every((l) => l.resolution === "create_new" && l.typeName === "Wooden Camera Ultra QR Plate")).toBe(true);
    // Doing it again reuses the type instead of failing.
    await expect(createTypeFromLine(db, ctx, review.lines[0]!.id, { manufacturer: "Wooden Camera", model: "Ultra QR Plate" })).resolves.toBeTruthy();
    const types = await db.select().from(s.equipmentType).where(and(eq(s.equipmentType.workspaceId, ctx.workspaceId), eq(s.equipmentType.model, "Ultra QR Plate")));
    expect(types).toHaveLength(1);
    expect(types[0]!.categoryId).toBe(f.category.id);
  });
});

describe("sets suggested by the note's layout", () => {
  it("creates a set from the lines grouped under one heading, packed and expected", async () => {
    const { suggestedSets, createSetFromDocument } = await import("../src/server/domain/document-sets");
    const tag = Math.random().toString(36).slice(2, 7);
    const id = await upload(
      new FakeExtractor(
        extraction([
          line({ description: "Bolt TX", serial_numbers: [`ST-${tag}-1`], catalog_match: "Teradek Bolt 6 XT 750 TX", set_name: "Funk-Set 1" }),
          line({ description: "Bolt TX", serial_numbers: [`ST-${tag}-2`], catalog_match: "Teradek Bolt 6 XT 750 TX", set_name: "Funk-Set 1" }),
          line({ description: "Sandsack", quantity: 4, catalog_match: "Matthews Sandbag 15 lb", set_name: "Funk-Set 1" }),
          line({ description: "Sandsack", quantity: 2, catalog_match: "Matthews Sandbag 15 lb" }),
        ], { rental_house_match: "ARRI Rental" }),
      ),
    );
    const review = await getDocumentReview(db, ctx, id);
    expect(review.lines.map((l) => l.setName)).toEqual(["Funk-Set 1", "Funk-Set 1", "Funk-Set 1", null]);
    await expect(createSetFromDocument(db, ctx, id, "Funk-Set 1")).rejects.toThrow(/Confirm the delivery note first/);
    await confirmDelivery(db, ctx, id);

    const [sg] = await suggestedSets(db, ctx.workspaceId, id);
    expect(sg).toMatchObject({ name: "Funk-Set 1", lines: 3, units: 6, existing: null });
    const r = await createSetFromDocument(db, ctx, id, "Funk-Set 1");
    expect(r.created).toBe(true);
    const d = await getCaseDetail(db, ctx, r.id);
    expect(d.items.reduce((n, i) => n + i.quantity, 0)).toBe(6);
    expect(d.comparison.complete).toBe(true);
    // Done once: the suggestion now points at the set.
    expect((await suggestedSets(db, ctx.workspaceId, id))[0]!.existing?.id).toBe(r.id);
    expect((await createSetFromDocument(db, ctx, id, "Funk-Set 1")).created).toBe(false);
  });
});

describe("case lines", () => {
  it("are recognised by their wording", async () => {
    const { looksLikeCase } = await import("../src/server/domain/document-matching");
    for (const yes of ["Koffer f. BLACKWING 4-fach", "Case", "Peli 1510 Case", "Transportkoffer Objektive", "Flightcase Monitor"]) expect(looksLikeCase(yes), yes).toBe(true);
    for (const no of ["Casey Adapter", "Sandsack 15lb", "ARRI ALEXA 35", "Kofferraum-Halterung"]) expect(looksLikeCase(no), no).toBe(false);
  });

  it("become a set holding the items grouped with them when the note is confirmed", async () => {
    const tag = Math.random().toString(36).slice(2, 7);
    const id = await upload(
      new FakeExtractor(
        extraction(
          [
            line({ description: "Koffer f. Funk 2-fach", asset_numbers: [`K-${tag}`], is_container: true, set_name: "Funk" }),
            line({ description: "Bolt TX", serial_numbers: [`KT-${tag}-1`], catalog_match: "Teradek Bolt 6 XT 750 TX", set_name: "Funk" }),
            line({ description: "Bolt TX", serial_numbers: [`KT-${tag}-2`], catalog_match: "Teradek Bolt 6 XT 750 TX", set_name: "Funk" }),
          ],
          { rental_house_match: "ARRI Rental" },
        ),
      ),
    );
    const review = await getDocumentReview(db, ctx, id);
    expect(review.lines.map((l) => l.resolution)).toEqual(["create_set", "create_new", "create_new"]);
    const { received } = await confirmDelivery(db, ctx, id);
    expect(received).toBe(2); // the case is not an item

    const [set] = await db.select().from(s.equipmentCase).where(eq(s.equipmentCase.barcode, `K-${tag}`));
    expect(set!.name).toBe("Koffer f. Funk 2-fach");
    const d = await getCaseDetail(db, ctx, set!.id);
    expect(d.items).toHaveLength(2);
    expect(d.comparison.complete).toBe(true);
    const items = await db.select().from(s.equipmentItem).where(eq(s.equipmentItem.assetNumber, `K-${tag}`));
    expect(items).toHaveLength(0);
  });

  it("can be corrected by the reviewer either way", async () => {
    const id = await upload(new FakeExtractor(extraction([line({ description: "Lens Case Pro", catalog_match: null })])));
    const [l] = (await getDocumentReview(db, ctx, id)).lines;
    expect(l!.resolution).toBe("create_set"); // guessed from the wording
    await updateLine(db, ctx, l!.id, { description: l!.description, quantity: 1, containerField: "1" } as never);
    expect((await getDocumentReview(db, ctx, id)).lines[0]!.resolution).not.toBe("create_set");
    await updateLine(db, ctx, l!.id, { description: l!.description, quantity: 1, containerField: "1", isContainer: "1" } as never);
    expect((await getDocumentReview(db, ctx, id)).lines[0]!.resolution).toBe("create_set");
  });
});
