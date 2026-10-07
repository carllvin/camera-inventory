"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionState } from "@/server/actions";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { revertEvent } from "@/server/domain/revert";

/** Undo one history entry (the opposite change is recorded as a new entry). */
export async function undoEventAction(eventId: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await revertEvent(getDb(), await getCtx(), eventId);
    revalidatePath("/", "layout");
    return "Undone.";
  });
}
