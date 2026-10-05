import { headers } from "next/headers";
import sharp from "sharp";
import { auth } from "@/server/auth/auth";
import { getDb } from "@/server/db/client";
import { getCandidateThumbForUser } from "@/server/domain/image-picker";
import { fetchRemoteImage } from "@/server/media/safe-fetch";
import { UUID_RE } from "@/server/pages";

/**
 * Thumbnail proxy for image-search candidates: fetched server-side with SSRF
 * protection and re-encoded, so browsers never hotlink third-party sites.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return new Response("Not found", { status: 404 });
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const url = await getCandidateThumbForUser(getDb(), session.user.id, id);
  if (!url) return new Response("Not found", { status: 404 });
  try {
    const img = await fetchRemoteImage(url, { maxBytes: 8 * 1024 * 1024, timeoutMs: 8000 });
    const webp = await sharp(img.bytes, { limitInputPixels: 50_000_000 }).rotate().resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
    return new Response(new Uint8Array(webp), { headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=86400" } });
  } catch {
    return new Response("Unavailable", { status: 502 });
  }
}
