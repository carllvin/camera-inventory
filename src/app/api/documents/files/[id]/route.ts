import { headers } from "next/headers";
import { auth } from "@/server/auth/auth";
import { getDb } from "@/server/db/client";
import { getDocumentFileForUser } from "@/server/domain/documents";
import { UUID_RE } from "@/server/pages";
import { getStorage } from "@/server/storage";

/** Original uploaded document file (PDF/photo), for members of its workspace only. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return new Response("Not found", { status: 404 });
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const file = await getDocumentFileForUser(getDb(), session.user.id, id);
  if (!file) return new Response("Not found", { status: 404 });
  const obj = await getStorage().get(file.storageKey);
  if (!obj) return new Response("Not found", { status: 404 });
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(obj.body), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(obj.body.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${encodeURIComponent(file.fileName)}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
    },
  });
}
