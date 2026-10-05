/**
 * Object storage abstraction. Documents and photos never live in the database;
 * rows store only the key. Drivers: local disk (dev, small installs) and any
 * S3-compatible service (MinIO in the Docker stack, AWS S3, Cloudflare R2).
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

export interface StorageProvider {
  readonly name: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/;

export function assertKey(key: string) {
  if (!KEY_RE.test(key) || key.includes("..") || key.includes("//")) {
    throw new Error(`Invalid storage key: ${key}`);
  }
}

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

export class LocalStorage implements StorageProvider {
  readonly name = "local";
  private readonly root: string;
  constructor(root: string) {
    this.root = path.resolve(root);
  }
  private file(key: string) {
    assertKey(key);
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error("Storage key escapes root");
    return p;
  }
  async put(key: string, body: Buffer) {
    const p = this.file(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, body);
  }
  async get(key: string) {
    try {
      const body = await readFile(this.file(key));
      return { body, contentType: TYPES[path.extname(key).toLowerCase()] ?? "application/octet-stream" };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
}

export class S3Storage implements StorageProvider {
  readonly name = "s3";
  private bucketReady: Promise<void> | null = null;
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  /** Create the bucket on first use (MinIO starts empty). */
  private ensureBucket() {
    this.bucketReady ??= (async () => {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      } catch {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      }
    })().catch((err) => {
      this.bucketReady = null;
      throw err;
    });
    return this.bucketReady;
  }

  async put(key: string, body: Buffer, contentType: string) {
    assertKey(key);
    await this.ensureBucket();
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }
  async get(key: string) {
    assertKey(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const bytes = await res.Body!.transformToByteArray();
      return { body: Buffer.from(bytes), contentType: res.ContentType ?? "application/octet-stream" };
    } catch (err) {
      if (err instanceof NoSuchKey || (err as { name?: string }).name === "NoSuchKey") return null;
      throw err;
    }
  }
  async delete(key: string) {
    assertKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export function createStorageFromEnv(env: Record<string, string | undefined> = process.env): StorageProvider {
  const driver = env.STORAGE_DRIVER ?? "local";
  if (driver === "s3") {
    const required = ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;
    for (const k of required) if (!env[k]) throw new Error(`${k} is required when STORAGE_DRIVER=s3`);
    const client = new S3Client({
      endpoint: env.S3_ENDPOINT || undefined,
      region: env.S3_REGION || "us-east-1",
      forcePathStyle: env.S3_FORCE_PATH_STYLE !== "false",
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
    });
    return new S3Storage(client, env.S3_BUCKET!);
  }
  if (driver === "local") return new LocalStorage(env.STORAGE_LOCAL_DIR || "./storage");
  throw new Error(`Unknown STORAGE_DRIVER: ${driver}`);
}

let cached: StorageProvider | undefined;
export function getStorage(): StorageProvider {
  cached ??= createStorageFromEnv();
  return cached;
}
