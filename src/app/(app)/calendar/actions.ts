"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionState } from "@/server/actions";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { disableCalendarToken, rotateCalendarToken } from "@/server/domain/reminders";

export async function rotateCalendarLinkAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await rotateCalendarToken(getDb(), (await getCtx()).userId);
    revalidatePath("/calendar");
    revalidatePath("/settings");
    return "New calendar link created. The old one no longer works.";
  });
}

export async function disableCalendarLinkAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await disableCalendarToken(getDb(), (await getCtx()).userId);
    revalidatePath("/calendar");
    revalidatePath("/settings");
    return "Calendar link switched off.";
  });
}
