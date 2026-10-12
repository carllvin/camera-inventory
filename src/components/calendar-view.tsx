import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { createNeedAction, createNeedInProjectAction } from "@/app/(app)/projects/actions";
import { eventHref, eventTitle, eventTone, type EventTone } from "@/lib/calendar-text";
import { cn, todayIso } from "@/lib/format";
import { getDb } from "@/server/db/client";
import { calendarEvents, type CalEvent } from "@/server/domain/calendar";
import type { Ctx } from "@/server/domain/context";
import { listActiveProjects } from "@/server/domain/current-project";
import { listRentalHouses } from "@/server/domain/rental-houses";
import { addDays } from "@/server/domain/return-dates";
import { getFormat, getIntlLocale, getT, getTN } from "@/server/i18n";
import { ActionForm, SubmitButton } from "./forms";
import { NeedFields } from "./need-fields";
import { Card, CardHeader } from "./ui";

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

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDay = (v: unknown): v is string => typeof v === "string" && ISO_DAY.test(v) && !Number.isNaN(Date.parse(v));

/** Monday on or before the 1st, through the Sunday on or after the last day. */
function monthGrid(month: string) {
  const first = `${month}-01`;
  const d = new Date(`${first}T12:00:00Z`);
  const start = addDays(first, -((d.getUTCDay() + 6) % 7));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)).toISOString().slice(0, 10);
  const end = addDays(last, (7 - new Date(`${last}T12:00:00Z`).getUTCDay()) % 7);
  const days: string[] = [];
  for (let x = start; x <= end; x = addDays(x, 1)) days.push(x);
  return { first, days };
}

const shiftMonth = (month: string, n: number) => {
  const d = new Date(`${month}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};

/**
 * The calendar: overdue first, then an agenda (phones) or the month (desktop).
 * A click on a day opens "plan extra equipment" for that day.
 */
export async function CalendarView({
  ctx,
  projectId,
  basePath,
  month: monthParam,
  add,
  canEdit,
  showOverdue = true,
}: {
  ctx: Ctx;
  /** Fixed project (project page); null = all active projects. */
  projectId: string | null;
  /** Where month and day links point. */
  basePath: string;
  month?: string;
  /** Day chosen for planning (YYYY-MM-DD). */
  add?: string;
  canEdit: boolean;
  showOverdue?: boolean;
}) {
  const db = getDb();
  const [t, tn, f, intl] = await Promise.all([getT(), getTN(), getFormat(), getIntlLocale()]);
  const today = todayIso();
  const addDay = isIsoDay(add) ? add : null;
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : (addDay ?? today).slice(0, 7);
  const grid = monthGrid(month);
  const agendaEnd = addDays(today, AGENDA_DAYS);
  const from = grid.days[0]! < today ? grid.days[0]! : today;
  const to = grid.days.at(-1)! > agendaEnd ? grid.days.at(-1)! : agendaEnd;
  const [events, houses, projects] = await Promise.all([
    calendarEvents(db, ctx.workspaceId, { from, to, today, projectId }),
    canEdit ? listRentalHouses(db, ctx) : Promise.resolve([]),
    canEdit && !projectId ? listActiveProjects(db, ctx) : Promise.resolve([]),
  ]);

  const overdue = events.filter((e) => e.kind === "due" && e.overdue);
  const byDay = new Map<string, CalEvent[]>();
  for (const e of events) if (!(e.kind === "due" && e.overdue)) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  const agendaDays = [...new Set(events.filter((e) => !(e.kind === "due" && e.overdue) && e.date >= today && e.date <= agendaEnd).map((e) => e.date))];

  const q = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ month, ...(addDay ? { add: addDay } : {}), ...patch });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `${basePath}?${p}`;
  };
  const dayHref = (d: string) => `${q({ add: d, month: d.slice(0, 7) })}#plan`;
  const weekday = new Intl.DateTimeFormat(intl, { weekday: "short", timeZone: "UTC" });
  const longDay = (d: string) => new Intl.DateTimeFormat(intl, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  const dayHead = (d: string) => (d === today ? t("Today") : d === addDays(today, 1) ? t("Tomorrow") : longDay(d));
  const showProject = !projectId;

  const Row = ({ e }: { e: CalEvent }) => {
    const tone = eventTone(e, today);
    const title = eventTitle(e, t, tn, f);
    const sub = [
      showProject || e.kind === "project_start" || e.kind === "project_end" ? e.projectName : null,
      e.kind === "delivery" || e.kind === "return_note" ? e.number : null,
      e.kind === "due" && e.overdue ? f.formatDate(e.date) : null,
    ]
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
          <ul className="space-y-1 pr-4 pb-2.5 pl-9 text-sm">
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
    <div className="space-y-6">
      {showOverdue && overdue.length > 0 && (
        <Card className="border-danger/40">
          <CardHeader title={<span className="text-danger">{t("Overdue")}</span>} />
          <ul className="divide-y divide-border">
            {overdue.map((e, i) => (
              <li key={i}>
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
                <div className="flex items-center justify-between border-b border-border px-4 py-2">
                  <h2 className={cn("text-xs font-semibold tracking-wide uppercase", d === today ? "text-accent" : "text-muted")}>{dayHead(d)}</h2>
                  {canEdit && (
                    <Link href={dayHref(d)} className="rounded p-0.5 text-muted hover:bg-surface-2 hover:text-text" aria-label={t("Plan extra equipment on {date}", { date: longDay(d) })}>
                      <Plus className="size-4" />
                    </Link>
                  )}
                </div>
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

      {/* Desktop: the month; a click on a day plans extra equipment for it. */}
      <Card className="hidden md:block">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <Link href={q({ month: shiftMonth(month, -1), add: "" })} className="rounded-md p-1 hover:bg-surface-2" aria-label={t("Previous month")}>
            <ChevronLeft className="size-4" />
          </Link>
          <h2 className="text-sm font-semibold">
            {new Intl.DateTimeFormat(intl, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${grid.first}T12:00:00Z`))}
            {month !== today.slice(0, 7) && (
              <Link href={basePath} className="ml-2 text-xs font-normal text-accent hover:underline">
                {t("Today")}
              </Link>
            )}
          </h2>
          <Link href={q({ month: shiftMonth(month, 1), add: "" })} className="rounded-md p-1 hover:bg-surface-2" aria-label={t("Next month")}>
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
              <div
                key={d}
                className={cn("group/day relative min-h-24 border-r border-b border-border p-1 text-xs [&:nth-child(7n)]:border-r-0", !inMonth && "bg-surface-2/40 text-muted", d === addDay && "ring-2 ring-accent ring-inset")}
              >
                <div className="mb-0.5 flex items-center justify-between">
                  {canEdit ? (
                    <Link href={dayHref(d)} className={cn("flex size-5 items-center justify-center rounded-full tabular-nums hover:bg-surface-2", d === today && "bg-accent font-semibold text-accent-fg hover:bg-accent")}>
                      {Number(d.slice(8))}
                    </Link>
                  ) : (
                    <span className={cn("flex size-5 items-center justify-center rounded-full tabular-nums", d === today && "bg-accent font-semibold text-accent-fg")}>{Number(d.slice(8))}</span>
                  )}
                  {canEdit && (
                    <Link
                      href={dayHref(d)}
                      className="rounded p-0.5 text-muted opacity-0 group-hover/day:opacity-100 hover:bg-surface-2 hover:text-text focus-visible:opacity-100"
                      aria-label={t("Plan extra equipment on {date}", { date: longDay(d) })}
                    >
                      <Plus className="size-3.5" />
                    </Link>
                  )}
                </div>
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

      {canEdit && (
        <Card id="plan">
          <CardHeader
            title={addDay ? t("Plan extra equipment on {date}", { date: longDay(addDay) }) : t("Plan extra equipment")}
            action={
              addDay && (
                <Link href={q({ add: "" })} className="text-xs text-muted hover:text-text">
                  {t("Close")}
                </Link>
              )
            }
          />
          {addDay ? (
            <ActionForm action={projectId ? createNeedAction.bind(null, projectId) : createNeedInProjectAction} className="grid gap-3 p-4 sm:grid-cols-2" resetOnSuccess>
              <NeedFields
                t={t}
                need={null}
                formKey={`cal-${addDay}`}
                from={addDay}
                rentalHouses={houses.map((h) => ({ value: h.id, label: h.name }))}
                projects={projectId ? undefined : projects.map((p, i) => ({ value: p.id, label: p.name, selected: i === 0 && projects.length === 1 }))}
              />
              <div className="sm:col-span-2">
                <SubmitButton>{t("Add to plan")}</SubmitButton>
              </div>
            </ActionForm>
          ) : (
            <p className="p-4 text-sm text-muted">
              {t("Click a day in the calendar (or + next to it) to plan extra equipment for it.")}{" "}
              <Link href={dayHref(today)} className="text-accent hover:underline">
                {t("Plan from today")}
              </Link>
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
