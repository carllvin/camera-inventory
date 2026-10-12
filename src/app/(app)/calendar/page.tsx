import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { CalendarLinkCard } from "@/components/calendar-link";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { eventHref, eventTitle, eventTone, type EventTone } from "@/lib/calendar-text";
import { cn, todayIso } from "@/lib/format";
import { getCtx } from "@/server/auth/context";
import { getCurrentProject } from "@/server/current-project";
import { getDb } from "@/server/db/client";
import { calendarEvents, type CalEvent } from "@/server/domain/calendar";
import { getReminderSettings } from "@/server/domain/reminders";
import { addDays } from "@/server/domain/return-dates";
import { getFormat, getIntlLocale, getT, getTN } from "@/server/i18n";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Calendar") };
}

const AGENDA_DAYS = 45;

const DOT: Record<EventTone, string> = {
  danger: "bg-danger",
  warn: "bg-warn",
  plan: "bg-violet-500",
  doc: "bg-sky-500",
  project: "bg-zinc-400",
};
const CHIP: Record<EventTone, string> = {
  danger: "bg-danger/15 text-danger",
  warn: "bg-warn/15 text-warn",
  plan: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  doc: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  project: "bg-surface-2 text-muted",
};

/** Monday on or before the 1st, through the Sunday on or after the last day. */
function monthGrid(month: string) {
  const first = `${month}-01`;
  const d = new Date(`${first}T12:00:00Z`);
  const start = addDays(first, -((d.getUTCDay() + 6) % 7));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)).toISOString().slice(0, 10);
  const end = addDays(last, (7 - new Date(`${last}T12:00:00Z`).getUTCDay()) % 7);
  const days: string[] = [];
  for (let x = start; x <= end; x = addDays(x, 1)) days.push(x);
  return { first, last, days };
}

const shiftMonth = (month: string, n: number) => {
  const d = new Date(`${month}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const db = getDb();
  const [{ current }, t, tn, f, intl, settings] = await Promise.all([getCurrentProject(), getT(), getTN(), getFormat(), getIntlLocale(), getReminderSettings(db, ctx.userId)]);
  const today = todayIso();
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const grid = monthGrid(month);
  const agendaEnd = addDays(today, AGENDA_DAYS);
  const from = grid.days[0]! < today ? grid.days[0]! : today;
  const to = grid.days.at(-1)! > agendaEnd ? grid.days.at(-1)! : agendaEnd;
  const events = await calendarEvents(db, ctx.workspaceId, { from, to, today, projectId: current?.id });

  const overdue = events.filter((e) => e.kind === "due" && e.overdue);
  const upcoming = events.filter((e) => !(e.kind === "due" && e.overdue) && e.date >= today && e.date <= agendaEnd);
  const byDay = new Map<string, CalEvent[]>();
  for (const e of events) if (!(e.kind === "due" && e.overdue)) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  const agendaDays = [...new Set(upcoming.map((e) => e.date))];

  const weekday = new Intl.DateTimeFormat(intl, { weekday: "short", timeZone: "UTC" });
  const dayHead = (d: string) =>
    d === today ? t("Today") : d === addDays(today, 1) ? t("Tomorrow") : new Intl.DateTimeFormat(intl, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  const showProject = !current;

  const Row = ({ e }: { e: CalEvent }) => {
    const tone = eventTone(e, today);
    const title = eventTitle(e, t, tn, f);
    const sub = [showProject || e.kind === "project_start" || e.kind === "project_end" ? e.projectName : null, e.kind === "delivery" || e.kind === "return_note" ? e.number : null, e.kind === "due" && e.overdue ? f.formatDate(e.date) : null]
      .filter(Boolean)
      .join(" · ");
    const head = (
      <>
        <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[tone])} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm">{title}</span>
          {sub && <span className="block text-xs text-muted">{sub}</span>}
        </span>
      </>
    );
    if (e.kind === "due" && e.items.length > 1) {
      return (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-2.5 hover:bg-surface-2/60 [&::-webkit-details-marker]:hidden">
            {head}
            <ChevronRight className="mt-1 size-3.5 shrink-0 text-muted transition-transform group-open:rotate-90" aria-hidden />
          </summary>
          <ul className="space-y-1 pb-2.5 pl-9 pr-4 text-sm">
            {e.items.map((i) => (
              <li key={i.id}>
                <Link href={`/equipment/${i.id}`} className="hover:underline">
                  {i.label}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      );
    }
    return (
      <Link href={eventHref(e)} className="flex items-start gap-3 px-4 py-2.5 hover:bg-surface-2/60">
        {head}
      </Link>
    );
  };

  return (
    <>
      <PageHeader title={t("Calendar")} subtitle={current ? current.name : t("All projects")} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          {overdue.length > 0 && (
            <Card className="border-danger/40">
              <CardHeader title={<span className="text-danger">{t("Overdue")}</span>} />
              <ul className="divide-y divide-border">
                {overdue.map((e) => (
                  <li key={`${e.kind}-${e.date}-${"key" in e ? e.key : e.projectId}`}>
                    <Row e={e} />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Phones: what comes next, day by day. */}
          <section className="md:hidden" aria-label={t("Next weeks")}>
            {agendaDays.length === 0 ? (
              <p className="rounded-xl border border-border bg-surface px-4 py-6 text-sm text-muted">{t("Nothing planned in the next weeks.")}</p>
            ) : (
              <div className="space-y-4">
                {agendaDays.map((d) => (
                  <Card key={d}>
                    <h2 className={cn("border-b border-border px-4 py-2 text-xs font-semibold tracking-wide uppercase", d === today ? "text-accent" : "text-muted")}>{dayHead(d)}</h2>
                    <ul className="divide-y divide-border">
                      {byDay.get(d)!.map((e, i) => (
                        <li key={i}>
                          <Row e={e} />
                        </li>
                      ))}
                    </ul>
                  </Card>
                ))}
              </div>
            )}
          </section>

          {/* Desktop: the month. */}
          <Card className="hidden md:block">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <Link href={`/calendar?month=${shiftMonth(month, -1)}`} className="rounded-md p-1 hover:bg-surface-2" aria-label={t("Previous month")}>
                <ChevronLeft className="size-4" />
              </Link>
              <h2 className="text-sm font-semibold">
                {new Intl.DateTimeFormat(intl, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${grid.first}T12:00:00Z`))}
                {month !== today.slice(0, 7) && (
                  <Link href="/calendar" className="ml-2 text-xs font-normal text-accent hover:underline">
                    {t("Today")}
                  </Link>
                )}
              </h2>
              <Link href={`/calendar?month=${shiftMonth(month, 1)}`} className="rounded-md p-1 hover:bg-surface-2" aria-label={t("Next month")}>
                <ChevronRight className="size-4" />
              </Link>
            </div>
            <div className="grid grid-cols-7 border-b border-border text-center text-[11px] text-muted">
              {grid.days.slice(0, 7).map((d) => (
                <div key={d} className="py-1">
                  {weekday.format(new Date(`${d}T12:00:00Z`))}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {grid.days.map((d) => {
                const list = byDay.get(d) ?? [];
                const inMonth = d.startsWith(month);
                return (
                  <div key={d} className={cn("min-h-24 border-r border-b border-border p-1 text-xs [&:nth-child(7n)]:border-r-0", !inMonth && "bg-surface-2/40 text-muted")}>
                    <div className={cn("mb-0.5 flex size-5 items-center justify-center rounded-full tabular-nums", d === today && "bg-accent font-semibold text-accent-fg")}>{Number(d.slice(8))}</div>
                    <ul className="space-y-0.5">
                      {list.slice(0, 3).map((e, i) => (
                        <li key={i}>
                          <Link href={eventHref(e)} title={`${eventTitle(e, t, tn, f)}${showProject ? ` · ${e.projectName}` : ""}`} className={cn("block truncate rounded px-1 py-0.5", CHIP[eventTone(e, today)])}>
                            {eventTitle(e, t, tn, f)}
                          </Link>
                        </li>
                      ))}
                      {list.length > 3 && <li className="px-1 text-muted">{t("+{n} more", { n: list.length - 3 })}</li>}
                    </ul>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
        <div className="space-y-6">
          <CalendarLinkCard token={settings.calendarToken} />
          <Card className="p-4 text-sm">
            <p className="text-muted">
              {t("Reminders on your phone: set up ntfy in Settings → Reminders.")}{" "}
              <Link href="/settings#reminders" className="text-accent hover:underline">
                {t("Open settings")}
              </Link>
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
