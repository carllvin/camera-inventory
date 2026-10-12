/**
 * The daily summary per person: what is overdue, what goes back in the next
 * days, what to order. Built from the calendar, in the person's language.
 */
import { eq } from "drizzle-orm";
import { eventTitle } from "@/lib/calendar-text";
import { makeFormat } from "@/lib/format";
import { INTL_LOCALE, isLocale, makeT, makeTN } from "@/lib/i18n/core";
import { dictionaryFor, namesFor } from "@/lib/i18n/dictionaries";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import { calendarEvents, workspacesOf, type CalEvent } from "../domain/calendar";
import { listNeeds } from "../domain/planned-needs";
import { addDays } from "../domain/return-dates";

export interface Digest {
  title: string;
  message: string;
  /** Path to open on tap. */
  path: string;
  count: number;
}

export async function buildDigest(db: DbOrTx, userId: string, today: string): Promise<Digest | null> {
  const [u] = await db.select({ locale: s.user.locale, days: s.user.reminderDaysBefore }).from(s.user).where(eq(s.user.id, userId));
  if (!u) return null;
  const locale = isLocale(u.locale) ? u.locale : "en";
  const t = makeT(dictionaryFor(locale));
  const tn = makeTN(namesFor(locale));
  const f = makeFormat(INTL_LOCALE[locale], t);
  const until = addDays(today, Math.max(0, u.days));

  const lines: string[] = [];
  let overdue = 0;
  let due = 0;
  let orders = 0;
  for (const w of await workspacesOf(db, userId)) {
    const events = await calendarEvents(db, w.id, { from: today, to: until, today });
    // Orders whose day has passed but that are still open keep coming until done.
    const late = (await listNeeds(db, { workspaceId: w.id }, { status: ["open"] })).filter((n) => n.orderBy && n.orderBy < today && n.needFrom >= today);
    const all: CalEvent[] = [
      ...events.filter((e) => e.kind === "due" || e.kind === "order" || e.kind === "need" || e.kind === "project_end"),
      ...late.map((n) => ({ kind: "order" as const, date: n.orderBy!, needId: n.id, needFrom: n.needFrom, label: n.label, quantity: n.quantity, house: n.rentalHouseName, projectId: n.projectId, projectName: n.projectName })),
    ];
    for (const e of all) {
      if (e.kind === "due" && e.overdue) overdue++;
      else if (e.kind === "due") due++;
      if (e.kind === "order") orders++;
      const when = e.kind === "due" && e.overdue ? f.formatDate(e.date) : e.date === today ? t("Today") : e.date === addDays(today, 1) ? t("Tomorrow") : f.formatDate(e.date);
      lines.push(`• ${when}: ${eventTitle(e, t, tn, f)} (${e.projectName})`);
    }
  }
  if (lines.length === 0) return null;
  const parts = [
    overdue ? (overdue === 1 ? t("1 overdue") : t("{n} overdue", { n: overdue })) : null,
    due ? (due === 1 ? t("1 return") : t("{n} returns", { n: due })) : null,
    orders ? (orders === 1 ? t("1 to order") : t("{n} to order", { n: orders })) : null,
  ].filter(Boolean);
  return {
    title: parts.length ? t("Camera Inventory: {what}", { what: parts.join(", ") }) : t("Camera Inventory: coming up"),
    message: lines.slice(0, 20).join("\n") + (lines.length > 20 ? `\n${t("+{n} more", { n: lines.length - 20 })}` : ""),
    path: "/calendar",
    count: lines.length,
  };
}
