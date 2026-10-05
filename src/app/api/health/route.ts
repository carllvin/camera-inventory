import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";

export const dynamic = "force-dynamic";

/** Liveness + database check for Docker / reverse-proxy health checks. */
export async function GET() {
  try {
    await getDb().execute(sql`SELECT 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
