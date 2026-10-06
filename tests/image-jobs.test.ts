/** Bulk "find images automatically": job list, progress, review list, cancel/resume. */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/server/db/schema";
import { BraveImageSearch, type ImageRanker } from "../src/server/ai/images";
import { DomainError, type Ctx } from "../src/server/domain/context";
import { createEquipmentType } from "../src/server/domain/equipment-types";
import {
  cancelImageJob,
  getImageJobOverview,
  releaseStaleImageJobs,
  resumeImageJob,
  retryImageSearch,
  runImageJob,
  startImageJob,
} from "../src/server/domain/image-jobs";
import type { PickerDeps } from "../src/server/domain/image-picker";
import { LocalStorage } from "../src/server/storage";
import { client, db, itemOnProject, makeFixture, type Fixture } from "./helpers/db";

let server: http.Server;
let base: string;
let dir: string;
let png: Buffer;
let searches = 0;

beforeAll(async () => {
  png = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#888" } }).png().toBuffer();
  server = http.createServer((req, res) => {
    if (req.url?.startsWith("/img")) return res.writeHead(200, { "content-type": "image/png" }).end(png);
    if (req.url?.startsWith("/brave")) {
      searches++;
      const q = new URL(req.url, "http://x").searchParams.get("q") ?? "";
      return res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({ results: [{ title: q, url: "https://maker.example/p", properties: { url: `${base}/img/${encodeURIComponent(q)}.png` }, meta_url: { hostname: "maker.example" } }] }),
      );
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  dir = await mkdtemp(path.join(tmpdir(), "ci-imgjob-"));
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await rm(dir, { recursive: true, force: true });
  await client.end();
});

// Confident for everything except products with "Obscure" in the name.
const ranker: ImageRanker = {
  async rank(product, candidates) {
    const ok = !product.name.includes("Obscure");
    return candidates.map((c) => ({ index: c.index, score: ok ? 0.95 : 0.4, exact_product: ok, shown_alone: true, clean_background: true, watermark_or_text: false, note: "" }));
  },
};

const deps = (over: Partial<PickerDeps> = {}): PickerDeps => ({
  search: new BraveImageSearch("test-key", `${base}/brave`),
  ranker,
  storage: new LocalStorage(dir),
  fetchOptions: { allowPrivateForTests: true },
  ...over,
});

async function setup() {
  const f: Fixture = await makeFixture();
  const ctx: Ctx = { workspaceId: f.ws.id, userId: f.user.id, role: "owner" };
  const used = await createEquipmentType(db, ctx, { manufacturer: "Teradek", model: "Bolt 6 XT 750 TX" });
  const obscure = await createEquipmentType(db, ctx, { manufacturer: "Acme", model: "Obscure Adapter" });
  await createEquipmentType(db, ctx, { manufacturer: "Sony", model: "VENICE 2 8K" }); // no items
  await itemOnProject(f, { equipmentTypeId: used.id, serialNumber: `T-${Date.now()}` });
  await itemOnProject(f, { equipmentTypeId: obscure.id, serialNumber: `O-${Date.now()}` });
  await itemOnProject(f, { serialNumber: `A-${Date.now()}` }); // fixture ALEXA 35
  return { f, ctx, used, obscure };
}

describe("automatic image jobs", () => {
  it("processes in-use types, adds confident images, lists the rest for review", async () => {
    const { ctx, used, obscure } = await setup();
    const before = await getImageJobOverview(db, ctx);
    expect(before.eligible).toEqual({ in_use: 3, all: 5 }); // ALEXA 35, Bolt, Obscure | + VENICE 2, BNC

    const job = await startImageJob(db, ctx, deps(), { scope: "in_use", limit: 25 });
    expect(job.total).toBe(3);
    await runImageJob(db, ctx, deps(), job.id, { delayMs: 0 });

    const o = await getImageJobOverview(db, ctx);
    expect(o.job).toMatchObject({ status: "done", processed: 3, applied: 2 });
    expect(o.review.map((r) => r.id)).toEqual([obscure.id]);
    expect(o.recentlyApplied.map((r) => r.id)).toContain(used.id);
    const [photo] = await db.select().from(s.photo).where(and(eq(s.photo.equipmentTypeId, used.id), eq(s.photo.kind, "reference")));
    expect(photo!.attribution).toMatch(/^auto-selected/);

    // Nothing left with items: types in review are not searched again; "all" still has two.
    expect(o.eligible).toEqual({ in_use: 0, all: 2 });
    await expect(startImageJob(db, ctx, deps(), { scope: "in_use", limit: 25 })).rejects.toThrow(/already has an image/);

    // "Try again next run" puts the reviewed type back.
    await retryImageSearch(db, ctx, obscure.id);
    expect((await getImageJobOverview(db, ctx)).eligible.in_use).toBe(1);
  });

  it("respects the limit, one running job at a time, cancel and resume", async () => {
    const { ctx } = await setup();
    const job = await startImageJob(db, ctx, deps(), { scope: "all", limit: 25 });
    expect(job.total).toBe(5);
    await expect(startImageJob(db, ctx, deps(), { scope: "all", limit: 25 })).rejects.toBeInstanceOf(DomainError);

    await cancelImageJob(db, ctx, job.id);
    await runImageJob(db, ctx, deps(), job.id, { delayMs: 0 });
    const [cancelled] = await db.select().from(s.imageJob).where(eq(s.imageJob.id, job.id));
    expect(cancelled).toMatchObject({ status: "cancelled", processed: 0, total: 0 });

    // A restart mid-run: the job goes stale, is marked interrupted and can be resumed.
    const second = await startImageJob(db, ctx, deps(), { scope: "all", limit: 25 });
    await db.update(s.imageJob).set({ updatedAt: new Date(Date.now() - 10 * 60_000) }).where(eq(s.imageJob.id, second.id));
    await releaseStaleImageJobs(db, ctx.workspaceId);
    await resumeImageJob(db, ctx, second.id);
    await runImageJob(db, ctx, deps(), second.id, { delayMs: 0 });
    const [done] = await db.select().from(s.imageJob).where(eq(s.imageJob.id, second.id));
    expect(done).toMatchObject({ status: "done", processed: 5 });

    const limited = await setup();
    expect((await startImageJob(db, limited.ctx, deps(), { scope: "all", limit: 25 })).total).toBe(5);
  });

  it("stops after repeated errors and needs both keys and an admin", async () => {
    const { ctx } = await setup();
    const failing = deps({ search: { name: "failing", search: async () => Promise.reject(new Error("quota exceeded")) } });
    const job = await startImageJob(db, ctx, failing, { scope: "all", limit: 25 });
    await runImageJob(db, ctx, failing, job.id, { delayMs: 0 });
    const [j] = await db.select().from(s.imageJob).where(eq(s.imageJob.id, job.id));
    expect(j).toMatchObject({ status: "failed", processed: 3, lastError: "quota exceeded" });
    // Technical errors don't land in the "choose by hand" list; the types stay eligible.
    const o = await getImageJobOverview(db, ctx);
    expect(o.review).toHaveLength(0);
    expect(o.eligible.all).toBe(5);

    await expect(startImageJob(db, ctx, deps({ ranker: null }), { scope: "all", limit: 25 })).rejects.toThrow(/ANTHROPIC_API_KEY/);
    await expect(startImageJob(db, ctx, deps({ search: null }), { scope: "all", limit: 25 })).rejects.toThrow(/BRAVE_SEARCH_API_KEY/);
    await expect(startImageJob(db, { ...ctx, role: "member" }, deps(), { scope: "all", limit: 25 })).rejects.toBeInstanceOf(DomainError);
    void searches;
  });
});
