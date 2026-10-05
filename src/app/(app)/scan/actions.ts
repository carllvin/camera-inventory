"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { runAction, type ActionState } from "@/server/actions";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { DomainError } from "@/server/domain/context";
import { findItemByCode } from "@/server/domain/equipment-items";

/** Resolve a scanned / typed code to an item or case and open it. */
export async function lookupCodeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const code = String(fd.get("code") ?? "").trim();
    if (!code) throw new DomainError("VALIDATION", "Scan or type a code first.");
    const ctx = await getCtx();
    const db = getDb();
    const items = await findItemByCode(db, ctx, code);
    if (items.length === 1) redirect(`/equipment/${items[0]!.id}`);
    if (items.length > 1) redirect(`/search?q=${encodeURIComponent(code)}`);
    const [c] = await db
      .select({ projectId: s.equipmentCase.projectId })
      .from(s.equipmentCase)
      .where(and(eq(s.equipmentCase.workspaceId, ctx.workspaceId), eq(s.equipmentCase.barcode, code)));
    if (c) redirect(`/projects/${c.projectId}/cases`);
    throw new DomainError("NOT_FOUND", `No equipment or case with code “${code}”.`, { code });
  });
}
