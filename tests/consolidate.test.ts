/** Current lists: compare with the database, add what is missing, remove what is not on the list. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/server/db/schema";
import type { DocumentExtractor, ExtractedLine } from "../src/server/ai/types";
import { addFromList, finishList, getConsolidation, removeNotOnList } from "../src/server/domain/consolidate";
import type { Ctx } from "../src/server/domain/context";
import { createDocumentFromUpload, runExtraction } from "../src/server/domain/documents";
import { createItem } from "../src/server/domain/equipment-items";
import { createProject } from "../src/server/domain/projects";
import { createRentalHouse } from "../src/server/domain/rental-houses";
import { LocalStorage } from "../src/server/storage";
import { client, db, makeFixture, type Fixture } from "./helpers/db";

let dir: string;
let storage: LocalStorage;
let f: Fixture;
let ctx: Ctx;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ci-list-"));
  storage = new LocalStorage(dir);
  f = await makeFixture();
  ctx = { workspaceId: f.ws.id, userId: f.user.id, role: "owner" };
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await client.end();
});

const line = (p: Partial<ExtractedLine> & { description: string }): ExtractedLine => ({
  raw_text: p.description, manufacturer: null, model: null, quantity: 1, serial_numbers: [], asset_numbers: [], catalog_match: null, is_equipment: true, confidence: 0.95, ...p,
});

function extractor(lines: ExtractedLine[]): DocumentExtractor {
  return {
    provider: "fake", model: "fake", available: true,
    async extract() {
      return { provider: "fake", model: "fake", meta: {}, extraction: { document_type: "other", rental_house_name: "List House", rental_house_match: "List House", document_number: `ML-${Date.now()}`, document_date: null, project_reference: null, project_number: null, customer_name: null, project_match: null, rental_start_date: null, rental_end_date: null, lines, warnings: [] } };
    },
  };
}

describe("current list", () => {
  it("shows the differences and fixes them in a few clicks", async () => {
    const rh = await createRentalHouse(db, ctx, { name: "List House" });
    const p = await createProject(db, ctx, { name: `List ${Date.now()}`, status: "shooting" });
    const tag = Date.now().toString(36);
    const cam1 = await createItem(db, ctx, { equipmentTypeId: f.camType.id, serialNumber: `L1-${tag}`, rentalHouseId: rh.id, projectId: p.id });
    const cam2 = await createItem(db, ctx, { equipmentTypeId: f.camType.id, serialNumber: `L2-${tag}`, rentalHouseId: rh.id, projectId: p.id });
    const cables = await createItem(db, ctx, { equipmentTypeId: f.cableType.id, quantity: 5, rentalHouseId: rh.id, projectId: p.id });

    const ex = extractor([
      line({ description: "ALEXA 35", serial_numbers: [`L1-${tag}`], catalog_match: "ARRI ALEXA 35" }),
      line({ description: "ALEXA 35", serial_numbers: [`L9-${tag}`], catalog_match: "ARRI ALEXA 35" }),
      line({ description: "BNC 1m", quantity: 3, catalog_match: "BNC 1m" }),
    ]);
    const up = await createDocumentFromUpload(db, storage, ctx, ex, { kind: "inventory_list", projectId: p.id }, [{ name: "liste.pdf", type: "application/pdf", bytes: Buffer.from(`%PDF-1.4\n% ${tag}\n%%EOF`) }]);
    await runExtraction(db, storage, ex, ctx.workspaceId, up.document.id);
    const id = up.document.id;

    let c = await getConsolidation(db, ctx, id);
    expect(c.present.map((x) => x.units).reduce((a, b) => a + b, 0)).toBe(4); // cam 1 + 3 cables
    expect(c.missing.map((m) => [m.label, m.canAdd])).toEqual([[`ARRI ALEXA 35 (SN L9-${tag})`, true]]);
    expect(c.extra.map((x) => [x.itemId, x.units]).sort()).toEqual([[cables.id, 2], [cam2.id, 1]].sort());

    expect(await addFromList(db, ctx, id, "all")).toBe(1);
    expect(await removeNotOnList(db, ctx, id, "all")).toBe(3);
    c = await getConsolidation(db, ctx, id);
    expect(c.missing).toHaveLength(0);
    expect(c.extra).toHaveLength(0);
    const [gone] = await db.select().from(s.equipmentItem).where(eq(s.equipmentItem.id, cam2.id));
    expect(gone).toMatchObject({ projectId: null, status: "returned" });
    const [still] = await db.select().from(s.equipmentItem).where(eq(s.equipmentItem.id, cam1.id));
    expect(still!.projectId).toBe(p.id);

    const doc = await finishList(db, ctx, id);
    expect(doc.status).toBe("confirmed");
    await expect(addFromList(db, ctx, id, "all")).rejects.toThrow();
  });
});
