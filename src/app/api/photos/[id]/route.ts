import { headers } from "next/headers";
import { auth } from "@/server/auth/auth";
import { getDb } from "@/server/db/client";
import { getPhotoKeyForUser } from "@/server/domain/photos";
import { UUID_RE } from "@/server/pages";
import { getStorage } from "@/server/storage";

/** Serve a photo to signed-in members of its workspace. Photos are immutable per id. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return new Response("Not found", { status: 404 });
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const size = new URL(req.url).searchParams.get("size") === "thumb" ? "thumb" : "full";
  const key = await getPhotoKeyForUser(getDb(), session.user.id, id, size);
  if (!key) return new Response("Not found", { status: 404 });
  const obj = await getStorage().get(key);
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(obj.body), {
    headers: {
      "Content-Type": obj.contentType,
      "Content-Length": String(obj.body.length),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
