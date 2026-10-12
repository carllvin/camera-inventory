"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionState } from "@/server/actions";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { setReturnDue, shiftReturnDue, type DueTarget } from "@/server/domain/return-dates";

/** Return date of a piece, set or delivery: set from the form ("" = follow the next level). */
export async function setReturnDueAction(kind: DueTarget["kind"], id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const r = await setReturnDue(getDb(), await getCtx(), { kind, id }, fd.get("returnDue") ?? "");
    revalidatePath("/", "layout");
    return r.own ? "Return date saved." : "Own return date removed.";
  });
}

export async function clearReturnDueAction(kind: DueTarget["kind"], id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await setReturnDue(getDb(), await getCtx(), { kind, id }, null);
    revalidatePath("/", "layout");
    return "Own return date removed.";
  });
}

export async function shiftReturnDueAction(kind: DueTarget["kind"], id: string, days: number, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await shiftReturnDue(getDb(), await getCtx(), { kind, id }, days);
    revalidatePath("/", "layout");
    return "Return date moved.";
  });
}
