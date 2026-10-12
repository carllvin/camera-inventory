import { eventTitle } from "@/lib/calendar-text";
import { makeFormat, todayIso } from "@/lib/format";
import { INTL_LOCALE, isLocale, makeT, makeTN } from "@/lib/i18n/core";
import { dictionaryFor, namesFor } from "@/lib/i18n/dictionaries";
import { buildIcs, type IcsEvent } from "@/lib/ics";
import { getDb } from "@/server/db/client";
import { calendarEvents, workspacesOf } from "@/server/domain/calendar";
import { userByCalendarToken } from "@/server/domain/reminders";
import { addDays } from "@/server/domain/return-dates";
import { publicBaseUrl } from "@/server/public-url";

export const dynamic = "force-dynamic";

/**
 * Personal calendar subscription (ICS). The secret token in the link is the
 * only key: calendar apps can't sign in. "New link" in the app revokes it.
 */
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = getDb();
  const user = await userByCalendarToken(db, token.replace(/\.ics$/, ""));
  if (!user) return new Response("Not found", { status: 404 });

  const locale = isLocale(user.locale) ? user.locale : "en";
  const t = makeT(dictionaryFor(locale));
  const tn = makeTN(namesFor(locale));
  const f = makeFormat(INTL_LOCALE[locale], t);
  const today = todayIso();
  const base = await publicBaseUrl();
  const events: IcsEvent[] = [];
  for (const w of await workspacesOf(db, user.id)) {
    for (const e of await calendarEvents(db, w.id, { from: addDays(today, -30), to: addDays(today, 180), today, withOverdue: false })) {
      const id = e.kind === "due" ? e.key : e.kind === "need" || e.kind === "order" ? e.needId : e.kind === "delivery" || e.kind === "return_note" ? e.documentId : e.projectId;
      events.push({
        uid: `${e.kind}-${id}-${e.date}@camera-inventory`,
        start: e.date,
        end: e.kind === "need" ? e.until : undefined,
        summary: `${eventTitle(e, t, tn, f)} · ${e.projectName}`,
        description: e.kind === "due" ? e.items.map((i) => i.label).join("\n") : undefined,
        url: `${base}${e.kind === "due" ? `/projects/${e.projectId}` : e.kind === "delivery" || e.kind === "return_note" ? `/documents/${e.documentId}` : e.kind === "need" || e.kind === "order" ? `/projects/${e.projectId}/plan` : `/projects/${e.projectId}`}`,
        alarm: e.kind === "due" || e.kind === "order",
      });
    }
  }
  return new Response(buildIcs(t("Camera Inventory"), events), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=300", "Content-Disposition": 'inline; filename="camera-inventory.ics"' },
  });
}
