/** Phase 4: object storage drivers, image normalization and the photo service. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import S3rver from "s3rver";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DomainError, type Ctx } from "../src/server/domain/context";
import { addPhoto, getPhotoKeyForUser, listPhotos, removePhoto } from "../src/server/domain/photos";
import { processImage } from "../src/server/media/images";
import { createStorageFromEnv, LocalStorage, type StorageProvider } from "../src/server/storage";
import { client, db, itemOnProject, makeFixture, type Fixture } from "./helpers/db";

let dir: string;
let local: LocalStorage;
let s3server: S3rver;
let s3: StorageProvider;
let f: Fixture;
let ctx: Ctx;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ci-storage-"));
  local = new LocalStorage(path.join(dir, "local"));
  s3server = new S3rver({ port: 0, address: "127.0.0.1", silent: true, directory: path.join(dir, "s3") });
  const { port } = (await s3server.run()) as unknown as { port: number };
  s3 = createStorageFromEnv({
    STORAGE_DRIVER: "s3",
    S3_ENDPOINT: `http://127.0.0.1:${port}`,
    S3_BUCKET: "camera-test",
    S3_ACCESS_KEY_ID: "S3RVER",
    S3_SECRET_ACCESS_KEY: "S3RVER",
  });
  f = await makeFixture();
  ctx = { workspaceId: f.ws.id, userId: f.user.id, role: "owner" };
});

afterAll(async () => {
  await s3server.close();
  await rm(dir, { recursive: true, force: true });
  await client.end();
});

/** A landscape JPEG that a phone took in portrait (EXIF orientation 6) with GPS data. */
async function phonePhoto() {
  return sharp({ create: { width: 300, height: 200, channels: 3, background: "#d9480f" } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExifMerge({ IFD0: { Make: "TestPhone" }, IFD3: { GPSLatitudeRef: "N" } })
    .toBuffer();
}

describe.each([
  ["local", () => local],
  ["s3 (MinIO-compatible)", () => s3],
])("%s storage", (_name, get) => {
  it("round-trips objects and returns null for missing keys", async () => {
    const storage = get();
    await storage.put("w/test/a/b.jpg", Buffer.from("hello"), "image/jpeg");
    const obj = await storage.get("w/test/a/b.jpg");
    expect(obj?.body.toString()).toBe("hello");
    expect(obj?.contentType).toBe("image/jpeg");
    await storage.delete("w/test/a/b.jpg");
    expect(await storage.get("w/test/a/b.jpg")).toBeNull();
  });

  it("rejects keys that try to escape the storage root", async () => {
    const storage = get();
    await expect(storage.put("../etc/passwd", Buffer.from("x"), "text/plain")).rejects.toThrow();
    await expect(storage.get("/absolute/path")).rejects.toThrow();
  });
});

describe("image processing", () => {
  it("applies EXIF rotation, strips metadata (GPS) and makes a thumbnail", async () => {
    const input = await phonePhoto();
    const inMeta = await sharp(input).metadata();
    expect(inMeta.orientation).toBe(6);
    expect(inMeta.exif).toBeDefined();
    const out = await processImage(input);
    expect([out.width, out.height]).toEqual([200, 300]);
    const meta = await sharp(out.full).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.format).toBe("jpeg");
    expect((await sharp(out.thumb).metadata()).format).toBe("webp");
  });

  it("puts transparent PNGs on white, not black", async () => {
    const png = await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const out = await processImage(png);
    for (const img of [out.full, out.thumb]) {
      const { data } = await sharp(img).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      expect(Math.min(...data)).toBeGreaterThan(245);
    }
  });

  it("refuses files that are not images", async () => {
    await expect(processImage(Buffer.from("%PDF-1.4 not an image"))).rejects.toBeInstanceOf(DomainError);
    await expect(processImage(Buffer.alloc(0))).rejects.toThrow("empty");
  });
});

describe("photo service", () => {
  it("attaches photos to an item, serves them only to members, hides removed ones", async () => {
    const item = await itemOnProject(f, { serialNumber: "PHOTO-1" });
    const photo = await addPhoto(db, local, ctx, { equipmentItemId: item.id }, { name: "dent.jpg", type: "image/jpeg", bytes: await phonePhoto() }, { caption: "Dent on handle" });
    expect(photo.kind).toBe("equipment");
    expect((await local.get(photo.storageKey))?.contentType).toBe("image/jpeg");
    expect(await getPhotoKeyForUser(db, f.user.id, photo.id, "thumb")).toBe(photo.thumbnailKey);

    const stranger = await makeFixture();
    expect(await getPhotoKeyForUser(db, stranger.user.id, photo.id, "full")).toBeNull();
    const strangerCtx: Ctx = { workspaceId: stranger.ws.id, userId: stranger.user.id, role: "owner" };
    await expect(addPhoto(db, local, strangerCtx, { equipmentItemId: item.id }, { name: "x.jpg", type: "image/jpeg", bytes: await phonePhoto() })).rejects.toThrow("not found");

    expect((await listPhotos(db, ctx, { equipmentItemId: item.id })).map((p) => p.caption)).toEqual(["Dent on handle"]);
    await removePhoto(db, ctx, photo.id);
    expect(await listPhotos(db, ctx, { equipmentItemId: item.id })).toHaveLength(0);
  });

  it("first reference photo of a type becomes the primary one", async () => {
    const a = await addPhoto(db, s3, ctx, { equipmentTypeId: f.cableType.id }, { name: "a.jpg", type: "image/jpeg", bytes: await phonePhoto() });
    const b = await addPhoto(db, s3, ctx, { equipmentTypeId: f.cableType.id }, { name: "b.jpg", type: "image/jpeg", bytes: await phonePhoto() });
    expect([a.isPrimary, b.isPrimary]).toEqual([true, false]);
  });

  it("viewers cannot upload", async () => {
    const item = await itemOnProject(f, { serialNumber: "PHOTO-2" });
    await expect(
      addPhoto(db, local, { ...ctx, role: "viewer" }, { equipmentItemId: item.id }, { name: "x.jpg", type: "image/jpeg", bytes: await phonePhoto() }),
    ).rejects.toThrow("permission");
  });
});
