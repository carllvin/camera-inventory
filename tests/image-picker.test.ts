/** Reference image picker: safe remote fetch, cached search, AI ranking, auto-pick. */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/server/db/schema";
import type { ImageRanker, ImageSearchProvider } from "../src/server/ai/images";
import { BraveImageSearch } from "../src/server/ai/images";
import type { Ctx } from "../src/server/domain/context";
import { applyCandidate, applyImageUrl, autoPickImage, defaultImageQuery, searchCandidates, type PickerDeps } from "../src/server/domain/image-picker";
import { listPhotos, setPrimaryReferencePhoto } from "../src/server/domain/photos";
import { fetchRemoteImage, isPublicAddress } from "../src/server/media/safe-fetch";
import { LocalStorage } from "../src/server/storage";
import { client, db, makeFixture, type Fixture } from "./helpers/db";

let server: http.Server;
let base: string;
let dir: string;
let f: Fixture;
let ctx: Ctx;
let png: Buffer;
let searches = 0;

beforeAll(async () => {
  png = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#ffffff" } }).png().toBuffer();
  server = http.createServer((req, res) => {
    if (req.url?.startsWith("/img")) return res.writeHead(200, { "content-type": "image/png" }).end(png);
    if (req.url === "/svg") return res.writeHead(200, { "content-type": "image/svg+xml" }).end("<svg/>");
    if (req.url === "/html") return res.writeHead(200, { "content-type": "text/html" }).end("<html/>");
    if (req.url === "/big") return res.writeHead(200, { "content-type": "image/png", "content-length": String(50 * 1024 * 1024) }).end();
    if (req.url === "/redirect") return res.writeHead(302, { location: "/img/1.png" }).end();
    if (req.url?.startsWith("/brave")) {
      searches++;
      return res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          results: [
            { title: "Rig with ALEXA 35", url: "https://shop.example/rig", thumbnail: { src: `${base}/img/t0.png` }, properties: { url: `${base}/img/0.png` }, meta_url: { hostname: "shop.example" } },
            { title: "ARRI ALEXA 35", url: "https://www.arri.com/alexa-35", thumbnail: { src: `${base}/img/t1.png` }, properties: { url: `${base}/img/1.png`, width: 1600, height: 1200 }, meta_url: { hostname: "www.arri.com" } },
            { title: "no image url", url: "https://x.example" },
          ],
        }),
      );
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  dir = await mkdtemp(path.join(tmpdir(), "ci-img-"));
  f = await makeFixture();
  ctx = { workspaceId: f.ws.id, userId: f.user.id, role: "owner" };
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await rm(dir, { recursive: true, force: true });
  await client.end();
});

const ranker: ImageRanker = {
  async rank(_p, candidates) {
    // Prefer the manufacturer image, penalize the rig.
    return candidates.map((c) => ({
      index: c.index,
      score: c.domain === "www.arri.com" ? 0.93 : 0.3,
      exact_product: c.domain === "www.arri.com",
      shown_alone: c.domain === "www.arri.com",
      clean_background: true,
      watermark_or_text: false,
      note: "",
    }));
  },
};

function deps(over: Partial<PickerDeps> = {}): PickerDeps {
  return {
    search: new BraveImageSearch("test-key", `${base}/brave`),
    ranker,
    storage: new LocalStorage(dir),
    fetchOptions: { allowPrivateForTests: true },
    ...over,
  };
}

describe("safe remote fetch", () => {
  it("classifies addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) expect(isPublicAddress(ip), ip).toBe(false);
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) expect(isPublicAddress(ip), ip).toBe(true);
  });

  it("refuses private targets, non-images, SVG and oversized files; follows safe redirects", async () => {
    await expect(fetchRemoteImage(`${base}/img/1.png`)).rejects.toThrow(/not allowed/);
    await expect(fetchRemoteImage(base.replace("127.0.0.1", "localhost") + "/img/1.png")).rejects.toThrow(/private network/);
    await expect(fetchRemoteImage("file:///etc/passwd")).rejects.toThrow(/http/);
    const t = { allowPrivateForTests: true };
    await expect(fetchRemoteImage(`${base}/html`, t)).rejects.toThrow(/not an image/);
    await expect(fetchRemoteImage(`${base}/svg`, t)).rejects.toThrow(/SVG/);
    await expect(fetchRemoteImage(`${base}/big`, t)).rejects.toThrow(/too large/);
    const ok = await fetchRemoteImage(`${base}/redirect`, t);
    expect(ok.contentType).toBe("image/png");
    expect(ok.finalUrl).toMatch(/\/img\/1\.png$/);
  });
});

describe("reference image picker", () => {
  it("searches once (cached), ranks the manufacturer image first, applies a candidate", async () => {
    const type = f.camType.id;
    const first = await searchCandidates(db, ctx, deps(), type, null);
    expect(first.map((c) => c.sourceDomain)).toEqual(["www.arri.com", "shop.example"]); // ranked, invalid result dropped
    expect(first[0]).toMatchObject({ query: "ARRI ALEXA 35", score: expect.closeTo(0.93, 3) });
    const before = searches;
    await searchCandidates(db, ctx, deps(), type, null);
    expect(searches).toBe(before); // served from cache
    await searchCandidates(db, ctx, deps(), type, null, { refresh: true });
    expect(searches).toBe(before + 1);

    const cands = await searchCandidates(db, ctx, deps(), type, null);
    const photo = await applyCandidate(db, ctx, deps(), type, cands[1]!.id);
    expect(photo).toMatchObject({ kind: "reference", isPrimary: true, attribution: "shop.example", sourceUrl: "https://shop.example/rig" });
    // Choosing another image makes it primary; the old one stays in the history.
    const second = await applyCandidate(db, ctx, deps(), type, cands[0]!.id);
    const photos = await listPhotos(db, ctx, { equipmentTypeId: type });
    expect(photos.map((p) => [p.id, p.isPrimary])).toEqual([[second.id, true], [photo.id, false]]);
    await setPrimaryReferencePhoto(db, ctx, photo.id);
    expect((await listPhotos(db, ctx, { equipmentTypeId: type }))[0]!.id).toBe(photo.id);
  });

  it("auto-picks only when confident and the type has no image yet", async () => {
    const [t] = await db.insert(s.equipmentType).values({ workspaceId: ctx.workspaceId, manufacturer: "ARRI", model: "MVF-2", name: "ARRI MVF-2" }).returning();
    const lowRanker: ImageRanker = { rank: async (_p, c) => c.map((x) => ({ index: x.index, score: 0.5, exact_product: true, shown_alone: true, clean_background: true, watermark_or_text: false, note: "" })) };
    expect(await autoPickImage(db, ctx, deps({ ranker: lowRanker }), t!.id)).toMatchObject({ applied: false, reason: "not-confident" });
    await db.delete(s.imageCandidate).where(eq(s.imageCandidate.equipmentTypeId, t!.id)); // drop the low-confidence cache
    const r = await autoPickImage(db, ctx, deps(), t!.id);
    expect(r.applied).toBe(true);
    const [p] = await db.select().from(s.photo).where(and(eq(s.photo.equipmentTypeId, t!.id), eq(s.photo.isPrimary, true)));
    expect(p!.attribution).toBe("auto-selected · www.arri.com");
    expect(await autoPickImage(db, ctx, deps(), t!.id)).toMatchObject({ applied: false, reason: "has-image" });
  });

  it("pasted URLs are downloaded safely; search needs a configured provider", async () => {
    const photo = await applyImageUrl(db, ctx, deps(), f.cableType.id, `${base}/img/pasted.png`);
    expect(photo.sourceUrl).toBe(`${base}/img/pasted.png`);
    await expect(applyImageUrl(db, ctx, deps({ fetchOptions: {} }), f.cableType.id, `${base}/img/x.png`)).rejects.toThrow(/not allowed/);
    await expect(searchCandidates(db, ctx, deps({ search: null as unknown as ImageSearchProvider }), f.cableType.id, null)).rejects.toThrow(/not configured/);
    const other = await makeFixture();
    await expect(searchCandidates(db, { workspaceId: other.ws.id, userId: other.user.id, role: "owner" }, deps(), f.camType.id, null)).rejects.toThrow(/not found/);
  });
});

describe("default image search", () => {
  it("adds the kind of product from the category, without repeating words", () => {
    expect(defaultImageQuery({ manufacturer: "ARRI", model: "ALEXA 35", categoryName: "Camera Bodies" })).toBe("ARRI ALEXA 35 Camera Body");
    expect(defaultImageQuery({ manufacturer: "ARRI", model: "Signature Prime 35mm T1.8", categoryName: "Spherical" })).toBe("ARRI Signature Prime 35mm T1.8 Lens");
    expect(defaultImageQuery({ manufacturer: "Cooke", model: "Anamorphic/i 40mm T2.3", categoryName: "Anamorphic" })).toBe("Cooke Anamorphic/i 40mm T2.3 Lens");
    expect(defaultImageQuery({ manufacturer: "OConnor", model: "2575D Fluid Head", categoryName: "Heads" })).toBe("OConnor 2575D Fluid Head");
    expect(defaultImageQuery({ manufacturer: "bebob", model: "B290cine", categoryName: "Batteries" })).toBe("bebob B290cine Battery");
    // Unknown or own categories: manufacturer + model only.
    expect(defaultImageQuery({ manufacturer: "ARRI", model: "LMB-6", categoryName: "Meine Kategorie" })).toBe("ARRI LMB-6");
    expect(defaultImageQuery({ manufacturer: "ARRI", model: "ALEXA 35" })).toBe("ARRI ALEXA 35");
  });
});
