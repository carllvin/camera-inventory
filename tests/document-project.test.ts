/** Detecting the project of a delivery / return note from what is printed on it. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/server/db/schema";
import { ManualExtractor } from "../src/server/ai";
import type { DocumentExtractor, Extraction } from "../src/server/ai/types";
import { DomainError, type Ctx } from "../src/server/domain/context";
import {
  confirmDelivery,
  createDocumentFromUpload,
  createProjectFromDocument,
  getDocumentReview,
  runExtraction,
  updateDocumentHeader,
} from "../src/server/domain/documents";
import { createProject } from "../src/server/domain/projects";
import { createRentalHouse } from "../src/server/domain/rental-houses";
import { LocalStorage } from "../src/server/storage";
import { client, db, makeFixture, type Fixture } from "./helpers/db";

let dir: string;
let storage: LocalStorage;
let f: Fixture;
let ctx: Ctx;
let cineMobil: { id: string };
let labyrinth: { id: string };

const pdf = (marker: string) => Buffer.from(`%PDF-1.4\n% ${marker}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF`);

function extraction(extra: Partial<Extraction>): Extraction {
  return {
    document_type: "delivery_note",
    rental_house_name: "Cine-Mobil GmbH - NL Köln",
    rental_house_match: "Cine-Mobil",
    document_number: `LS-${Math.random().toString(36).slice(2, 8)}`,
    document_date: "2026-08-31",
    project_reference: null,
    project_number: null,
    customer_name: null,
    project_match: null,
    rental_start_date: null,
    rental_end_date: null,
    lines: [
      {
        raw_text: "ARRI ALEXA 35",
        description: "ARRI ALEXA 35",
        manufacturer: "ARRI",
        model: "ALEXA 35",
        quantity: 1,
        serial_numbers: [`SN-${Math.random().toString(36).slice(2, 8)}`],
        asset_numbers: [],
        catalog_match: "ARRI ALEXA 35",
        is_equipment: true,
        confidence: 0.95,
      },
    ],
    warnings: [],
    ...extra,
  };
}

const fake = (ex: Extraction): DocumentExtractor => ({
  provider: "fake",
  model: "f",
  available: true,
  extract: async () => ({ extraction: ex, provider: "fake", model: "f", meta: {} }),
});

async function upload(ex: Extraction, projectId?: string) {
  const extractor = fake(ex);
  const r = await createDocumentFromUpload(db, storage, ctx, extractor, { kind: "delivery_note", projectId }, [
    { name: "ls.pdf", type: "application/pdf", bytes: pdf(Math.random().toString(36)) },
  ]);
  await runExtraction(db, storage, extractor, ctx.workspaceId, r.document.id);
  return getDocumentReview(db, ctx, r.document.id);
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ci-docproj-"));
  storage = new LocalStorage(dir);
  f = await makeFixture();
  ctx = { workspaceId: f.ws.id, userId: f.user.id, role: "owner" };
  cineMobil = await createRentalHouse(db, ctx, { name: "Cine-Mobil" });
  labyrinth = await createProject(db, ctx, { name: "Das verrückte Labyrinth", productionCompany: "SamFilm GmbH" });
  await createProject(db, ctx, { name: "Feature Film X", code: "FFX" });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await client.end();
});

describe("project detection", () => {
  it("detects the project from a similar production title and matches lines against it", async () => {
    const r = await upload(extraction({ project_reference: "Das verrueckte Labyrinth -|- KAMERA: Stamm", customer_name: "SamFilm GmbH" }));
    expect(r.doc.projectId).toBe(labyrinth.id);
    expect(r.doc.projectSource).toBe("detected");
    expect(r.projectDetection?.how).toBe("similar production title");
    expect(r.lines[0]!.resolution).toBe("create_new");
    expect(r.blockers).toEqual([]);
    const [ev] = await db.select().from(s.auditEvent).where(and(eq(s.auditEvent.documentId, r.doc.id), eq(s.auditEvent.action, "document.extracted")));
    expect(ev!.summary).toContain("project detected: Das verrückte Labyrinth");
  });

  it("uses the AI's pick from the project list and the project code", async () => {
    expect((await upload(extraction({ project_reference: "Some job title", project_match: "Feature Film X" }))).doc.projectSource).toBe("detected");
    const byCode = await upload(extraction({ project_reference: "ffx" }));
    expect(byCode.projectName).toBe("Feature Film X");
    expect(byCode.projectDetection?.how).toBe("same production title");
  });

  it("remembers the rental house's project number on confirm and matches by it next time", async () => {
    const first = await upload(extraction({ project_reference: "Das verrückte Labyrinth", project_number: "78120294" }));
    await confirmDelivery(db, ctx, first.doc.id);
    const [link] = await db
      .select()
      .from(s.projectRentalHouse)
      .where(and(eq(s.projectRentalHouse.projectId, labyrinth.id), eq(s.projectRentalHouse.rentalHouseId, cineMobil.id)));
    expect(link!.orderReference).toBe("78120294");

    // Next note: title printed differently, same project number.
    const next = await upload(extraction({ project_reference: "DVL Kamera Nachlieferung", project_number: "78 120 294" }));
    expect(next.doc.projectId).toBe(labyrinth.id);
    expect(next.projectDetection?.how).toBe("project number 78 120 294");
  });

  it("leaves an unknown production unassigned and creates the project only when asked", async () => {
    const r = await upload(
      extraction({ project_reference: "Nordlicht Staffel 2", customer_name: "Bavaria Fiction", rental_start_date: "2026-09-01", rental_end_date: "2026-11-30" }),
    );
    expect(r.doc.projectId).toBeNull();
    expect(r.blockers.map((b) => b.message)).toContain("Choose the project.");
    expect(r.projectHints).toMatchObject({ title: "Nordlicht Staffel 2", customer: "Bavaria Fiction", startDate: "2026-09-01", endDate: "2026-11-30" });
    const projectsBefore = await db.select().from(s.project).where(eq(s.project.workspaceId, ctx.workspaceId));

    const created = await createProjectFromDocument(db, ctx, r.doc.id, {
      name: "Nordlicht Staffel 2",
      productionCompany: "Bavaria Fiction",
      startDate: "2026-09-01",
      endDate: "2026-11-30",
    });
    const after = await getDocumentReview(db, ctx, r.doc.id);
    expect(after.doc.projectId).toBe(created.id);
    expect(after.doc.projectSource).toBe("reviewer");
    expect(after.blockers).toEqual([]);
    expect(await db.select().from(s.project).where(eq(s.project.workspaceId, ctx.workspaceId))).toHaveLength(projectsBefore.length + 1);
    // Same name twice is refused, not duplicated.
    const again = await upload(extraction({ project_reference: "Something else entirely" }));
    await expect(createProjectFromDocument(db, ctx, again.doc.id, { name: "nordlicht staffel 2" })).rejects.toBeInstanceOf(DomainError);
  });

  it("warns, but never switches, when a chosen project differs from the document", async () => {
    const r = await upload(extraction({ project_reference: "Das verrückte Labyrinth" }), f.project.id);
    expect(r.doc.projectId).toBe(f.project.id);
    expect(r.doc.projectSource).toBe("upload");
    expect(r.projectMismatch?.id).toBe(labyrinth.id);

    await updateDocumentHeader(db, ctx, r.doc.id, { projectId: labyrinth.id, rentalHouseId: r.doc.rentalHouseId ?? undefined });
    const fixed = await getDocumentReview(db, ctx, r.doc.id);
    expect(fixed.doc.projectSource).toBe("reviewer");
    expect(fixed.projectMismatch).toBeNull();
  });

  it("requires a project at upload when AI reading is not available; ignores closed projects", async () => {
    await expect(
      createDocumentFromUpload(db, storage, ctx, new ManualExtractor(), { kind: "delivery_note" }, [{ name: "x.pdf", type: "application/pdf", bytes: pdf("manual") }]),
    ).rejects.toThrow(/Choose the project/);

    const closed = await createProject(db, ctx, { name: "Old Commercial", status: "closed" });
    const r = await upload(extraction({ project_reference: "Old Commercial" }));
    expect(r.doc.projectId).toBeNull();
    expect(closed.id).toBeTruthy();
  });
});
