import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { searchEquipmentTypes } from "@/server/domain/equipment-types";

/** Type picker suggestions for the signed-in user's workspace. */
export async function GET(req: Request) {
  const ctx = await getCtx();
  const q = new URL(req.url).searchParams.get("q");
  const rows = await searchEquipmentTypes(getDb(), ctx, q, 20);
  return Response.json(
    rows.map((r) => ({ id: r.id, name: r.name, category: r.category, tracking: r.tracking })),
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
