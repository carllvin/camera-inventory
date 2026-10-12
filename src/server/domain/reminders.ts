/**
 * Personal reminders: the calendar subscription link and the daily ntfy summary.
 * Settings belong to the person (not the workspace); the summary covers every
 * workspace they are a member of.
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import { DomainError } from "./context";

/** ntfy server used when a person names none (self-hosters set NTFY_DEFAULT_SERVER). */
export const DEFAULT_NTFY_SERVER = (process.env.NTFY_DEFAULT_SERVER || "https://ntfy.sh").replace(/\/+$/, "");

export async function getReminderSettings(db: DbOrTx, userId: string) {
  const [u] = await db
    .select({
      ntfyServer: s.user.ntfyServer,
      ntfyTopic: s.user.ntfyTopic,
      hasToken: s.user.ntfyToken,
      reminderHour: s.user.reminderHour,
      reminderDaysBefore: s.user.reminderDaysBefore,
      calendarToken: s.user.calendarToken,
      locale: s.user.locale,
    })
    .from(s.user)
    .where(eq(s.user.id, userId));
  if (!u) throw new DomainError("NOT_FOUND", "User not found.");
  // The access token never leaves the server: only whether one is set.
  return { ...u, hasToken: Boolean(u.hasToken) };
}

const topic = z
  .string()
  .trim()
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Only letters, digits, - and _ (as in ntfy).")
  .or(z.literal(""));

export const reminderInput = z.object({
  ntfyServer: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === "" || /^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(v), "Enter the server address, e.g. https://ntfy.example.com")
    .optional(),
  ntfyTopic: topic.optional(),
  /** "" keeps the stored token, "-" removes it. */
  ntfyToken: z.string().trim().max(200).optional(),
  reminderHour: z.coerce.number().int().min(0).max(23),
  reminderDaysBefore: z.coerce.number().int().min(0).max(14),
});

export async function saveReminderSettings(db: DbOrTx, userId: string, input: unknown) {
  const d = reminderInput.parse(input);
  await db
    .update(s.user)
    .set({
      ntfyServer: d.ntfyServer ? d.ntfyServer.replace(/\/+$/, "") : null,
      ntfyTopic: d.ntfyTopic || null,
      ...(d.ntfyToken === "-" ? { ntfyToken: null } : d.ntfyToken ? { ntfyToken: d.ntfyToken } : {}),
      reminderHour: d.reminderHour,
      reminderDaysBefore: d.reminderDaysBefore,
    })
    .where(eq(s.user.id, userId));
}

/** A new secret link (the old one stops working). */
export async function rotateCalendarToken(db: DbOrTx, userId: string) {
  const token = randomBytes(24).toString("base64url");
  await db.update(s.user).set({ calendarToken: token }).where(eq(s.user.id, userId));
  return token;
}

export async function disableCalendarToken(db: DbOrTx, userId: string) {
  await db.update(s.user).set({ calendarToken: null }).where(eq(s.user.id, userId));
}

export async function userByCalendarToken(db: DbOrTx, token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [u] = await db.select({ id: s.user.id, name: s.user.name, locale: s.user.locale }).from(s.user).where(eq(s.user.calendarToken, token));
  return u ?? null;
}
