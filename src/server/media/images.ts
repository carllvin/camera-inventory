import sharp, { type Metadata } from "sharp";
import { DomainError } from "../domain/context";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ACCEPTED = new Set(["jpeg", "png", "webp", "heif", "avif", "tiff", "gif"]);

export interface ProcessedImage {
  full: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
}

/**
 * Normalize an uploaded photo: apply EXIF orientation, strip metadata
 * (GPS location from phones!), cap the size, and make a thumbnail.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  if (input.length === 0) throw new DomainError("VALIDATION", "The file is empty.");
  if (input.length > MAX_UPLOAD_BYTES) throw new DomainError("VALIDATION", "Photos can be at most 25 MB.");
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: 100_000_000 }).metadata();
  } catch {
    throw new DomainError("VALIDATION", "This file is not an image we can read. Use JPEG, PNG or WebP.");
  }
  if (!meta.format || !ACCEPTED.has(meta.format)) {
    throw new DomainError("VALIDATION", `Unsupported image format${meta.format ? ` (${meta.format})` : ""}. Use JPEG, PNG or WebP.`);
  }
  // Transparent areas (PNG/WebP cut-outs) on white: JPEG has no alpha and would turn them black.
  const base = () => sharp(input, { limitInputPixels: 100_000_000, failOn: "error" }).rotate().flatten({ background: "#ffffff" });
  try {
    const { data: full, info } = await base()
      .resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    const thumb = await base()
      .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();
    return { full, thumb, width: info.width, height: info.height };
  } catch {
    throw new DomainError("VALIDATION", "The image could not be processed. It may be damaged or in an unsupported format (e.g. HEIC).");
  }
}
