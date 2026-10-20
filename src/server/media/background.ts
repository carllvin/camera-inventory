/**
 * What is behind the product in a picture: transparent (cut out), plain white/light,
 * or anything else. Looks only at the image border, where a product shot on a
 * clean background has nothing but that background.
 */
import sharp from "sharp";

export type ImageBackground = "transparent" | "white" | "other";

const SIZE = 48;
const RING = 2;

/** Background of an image, or null when the bytes cannot be decoded. */
export async function detectBackground(bytes: Buffer): Promise<ImageBackground | null> {
  let px: Buffer;
  try {
    px = await sharp(bytes, { animated: false }).resize(SIZE, SIZE, { fit: "fill" }).ensureAlpha().raw().toBuffer();
  } catch {
    return null;
  }
  let border = 0;
  let clear = 0;
  let light = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (x >= RING && x < SIZE - RING && y >= RING && y < SIZE - RING) continue;
      const i = (y * SIZE + x) * 4;
      const [r, g, b, a] = [px[i]!, px[i + 1]!, px[i + 2]!, px[i + 3]!];
      border++;
      if (a < 32) clear++;
      else if (Math.min(r, g, b) >= 228 && Math.max(r, g, b) - Math.min(r, g, b) <= 18) light++;
    }
  }
  if (clear / border >= 0.6) return "transparent";
  // Transparent corners around a light frame count as a clean background too.
  if ((clear + light) / border >= 0.85) return clear > light ? "transparent" : "white";
  return "other";
}

/** Clean backgrounds first: cut-out, then white, then the rest (unknown last). */
export function backgroundRank(bg: string | null | undefined) {
  return bg === "transparent" ? 0 : bg === "white" ? 1 : bg === "other" ? 2 : 3;
}
