/**
 * Sends each person's daily summary once, at their hour (app time zone).
 * Safe with several app containers and restarts: the reminder_log row is
 * claimed before sending, so only one process sends it.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { localHour, todayIso } from "@/lib/format";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import { DEFAULT_NTFY_SERVER } from "../domain/reminders";
import { buildDigest } from "./digest";
import { sendNtfy } from "./ntfy";

export async function runReminderTick(db: DbOrTx, opts: { now?: Date; baseUrl?: string; send?: typeof sendNtfy } = {}) {
  const now = opts.now ?? new Date();
  const send = opts.send ?? sendNtfy;
  const today = todayIso(now);
  const hour = localHour(now);
  const users = await db
    .select({ id: s.user.id, server: s.user.ntfyServer, topic: s.user.ntfyTopic, token: s.user.ntfyToken, hour: s.user.reminderHour })
    .from(s.user)
    .where(isNotNull(s.user.ntfyTopic));
  let sent = 0;
  for (const u of users) {
    if (hour < u.hour) continue;
    const key = `digest:${today}`;
    const [claimed] = await db.insert(s.reminderLog).values({ userId: u.id, key }).onConflictDoNothing().returning({ id: s.reminderLog.id });
    if (!claimed) continue;
    try {
      const digest = await buildDigest(db, u.id, today);
      if (!digest) continue; // nothing due: the claimed row just records that the day was checked
      await send(u.server || DEFAULT_NTFY_SERVER, u.topic!, u.token, { title: digest.title, message: digest.message, click: opts.baseUrl ? `${opts.baseUrl}${digest.path}` : undefined });
      await db.update(s.reminderLog).set({ body: `${digest.title}\n${digest.message}` }).where(eq(s.reminderLog.id, claimed.id));
      sent++;
    } catch (err) {
      // Not sent: free the day again so the next tick retries.
      await db.delete(s.reminderLog).where(and(eq(s.reminderLog.id, claimed.id)));
      console.error(`[reminders] summary for user ${u.id} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return { sent };
}

let started = false;
/** Called once per server process (instrumentation.ts). */
export function startReminderLoop(getDb: () => DbOrTx, everyMs = 5 * 60_000) {
  if (started || process.env.REMINDERS === "off") return;
  started = true;
  const baseUrl = (process.env.BETTER_AUTH_URL || process.env.PUBLIC_URL || "").replace(/\/+$/, "") || undefined;
  const tick = () => runReminderTick(getDb(), { baseUrl }).catch((err) => console.error("[reminders] tick failed:", err));
  setTimeout(tick, 30_000).unref();
  setInterval(tick, everyMs).unref();
}
