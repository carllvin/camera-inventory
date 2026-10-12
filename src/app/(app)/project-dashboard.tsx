import Link from "next/link";
import { AlertTriangle, Box, CalendarClock, CalendarPlus, CircleCheck, FileText, PackageOpen, Search, Wrench } from "lucide-react";
import { ActivityList } from "@/components/activity";
import { CaseProgress } from "@/components/case-list";
import { Card, CardHeader } from "@/components/ui";
import { cn, DOCUMENT_KIND_LABEL, todayIso } from "@/lib/format";
import { getDb } from "@/server/db/client";
import { listCases } from "@/server/domain/cases";
import { hasRole, type Ctx } from "@/server/domain/context";
import { CalendarView } from "@/components/calendar-view";
import { listItems } from "@/server/domain/equipment-items";
import { listActivity, listDocuments, listIssues } from "@/server/domain/overview";
import { getProjectSummary } from "@/server/domain/projects";
import { listNeeds } from "@/server/domain/planned-needs";
import { addDays, bucketDue, listDueItems, type DueItem } from "@/server/domain/return-dates";
import { getFormat, getT, getTranslateMessage, getTN } from "@/server/i18n";

type Attention = { key: string; icon: typeof Box; tone: "danger" | "warn" | "neutral"; text: string; href: string };

/** Start page while a project is in focus: where it stands and what needs doing. */
/** The project page: what needs doing, the calendar, sets, activity. Header and figures come from the project layout. */
export async function ProjectDashboard({ ctx, projectId, month, add }: { ctx: Ctx; projectId: string; month?: string; add?: string }) {
  const db = getDb();
  const [{ project, counts, rentalHouses }, items, cases, issues, documents, activity] = await Promise.all([
    getProjectSummary(db, ctx, projectId),
    listItems(db, ctx, { projectId, limit: 500 }),
    listCases(db, ctx, { projectId }),
    listIssues(db, ctx, { projectId, openOnly: true, limit: 20 }),
    listDocuments(db, ctx, { projectId }),
    listActivity(db, ctx, { projectId, limit: 12 }),
  ]);
  const today = todayIso();
  const [dueItems, needs] = await Promise.all([
    listDueItems(db, ctx, { projectId }),
    listNeeds(db, ctx, { projectId, status: ["open"], until: addDays(today, 7) }),
  ]);
  const [t, f, tm, tn] = await Promise.all([getT(), getFormat(), getTranslateMessage(), getTN()]);
  const base = `/projects/${projectId}`;
  // The equipment list (Equipment tab) for this project.
  const eq = `/equipment?projectId=${projectId}`;

  const missing = items.filter((i) => i.status === "missing");
  const broken = items.filter((i) => i.condition === "damaged" || i.condition === "defective");
  const toReview = documents.filter((d) => ["uploaded", "processing", "extracted", "failed"].includes(d.status));
  const incomplete = cases.filter((c) => c.comparison.missingTotal > 0);
  const loose = items.filter((i) => !i.caseId).reduce((n, i) => n + i.quantity, 0);
  const label = (i: (typeof items)[number]) => `${tn(i.typeName)}${i.serialNumber ? ` (SN ${i.serialNumber})` : i.quantity > 1 ? ` × ${i.quantity}` : ""}`;

  const due = bucketDue(dueItems, today, 3);
  // One line per day and rental house: "Overdue since 12 Oct: 5 pieces to ARRI".
  const byDay = (list: DueItem[]) => {
    const groups = new Map<string, { due: string; house: string | null; units: number }>();
    for (const i of list) {
      const k = `${i.due}|${i.rentalHouseName ?? ""}`;
      const g = groups.get(k) ?? { due: i.due!, house: i.rentalHouseName, units: 0 };
      g.units += i.units;
      groups.set(k, g);
    }
    return [...groups.values()];
  };
  const pieces = (n: number) => (n === 1 ? t("1 piece") : t("{n} pieces", { n }));
  const dueText = (g: { due: string; house: string | null; units: number }, overdue: boolean) => {
    const what = g.house ? t("{pieces} to {house}", { pieces: pieces(g.units), house: g.house }) : pieces(g.units);
    if (overdue) return t("Overdue since {date}: {what}", { date: f.formatDate(g.due), what });
    if (g.due === today) return t("Due back today: {what}", { what });
    return t("Due back {date}: {what}", { date: f.formatDate(g.due), what });
  };
  const toOrder = needs.filter((n) => (n.orderBy ?? n.needFrom) <= addDays(today, 1));

  const attention: Attention[] = [
    ...byDay(due.overdue).map((g) => ({ key: `od-${g.due}-${g.house}`, icon: CalendarClock, tone: "danger" as const, text: dueText(g, true), href: "/calendar" })),
    ...byDay(due.soon).map((g) => ({ key: `ds-${g.due}-${g.house}`, icon: CalendarClock, tone: "warn" as const, text: dueText(g, false), href: "/calendar" })),
    ...toOrder.map((n) => ({
      key: `need-${n.id}`,
      icon: CalendarPlus,
      tone: "warn" as const,
      text: t("Order: {n} × {label} for {date}", { n: n.quantity, label: tn(n.label), date: f.formatDate(n.needFrom) }),
      href: `${base}/plan`,
    })),
    ...(due.undatedUnits > 0
      ? [{ key: "undated", icon: CalendarClock, tone: "neutral" as const, text: t("{pieces} without a return date: set the project's end or a date on the delivery note", { pieces: pieces(due.undatedUnits) }), href: `${base}/edit` }]
      : []),
    ...missing.slice(0, 5).map((i) => ({ key: `m-${i.id}`, icon: Search, tone: "danger" as const, text: t("Missing: {item}", { item: label(i) }), href: `/equipment/${i.id}` })),
    ...(missing.length > 5 ? [{ key: "m-more", icon: Search, tone: "danger" as const, text: t("{n} more missing", { n: missing.length - 5 }), href: `${eq}&status=missing` }] : []),
    ...broken.slice(0, 5).map((i) => ({ key: `b-${i.id}`, icon: Wrench, tone: "warn" as const, text: i.condition === "defective" ? t("Defective: {item}", { item: label(i) }) : t("Damaged: {item}", { item: label(i) }), href: `/equipment/${i.id}` })),
    ...(issues.length ? [{ key: "issues", icon: AlertTriangle, tone: "warn" as const, text: `${issues.length === 1 ? t("1 open issue") : t("{n} open issues", { n: issues.length })}${issues[0] ? ` — ${issues[0].title}${issues.length > 1 ? " …" : ""}` : ""}`, href: `${base}/issues` }] : []),
    ...toReview.map((d) => ({
      key: `d-${d.id}`,
      icon: FileText,
      tone: "neutral" as const,
      text: `${d.status === "failed" ? t("Could not be read") : d.status === "processing" ? t("Being read") : t("To review")}: ${DOCUMENT_KIND_LABEL[d.kind] ? t(DOCUMENT_KIND_LABEL[d.kind]!) : d.kind} ${d.documentNumber ?? d.title ?? ""}${d.rentalHouseName ? ` · ${d.rentalHouseName}` : ""}`,
      href: `/documents/${d.id}`,
    })),
    ...(incomplete.length > 3
      ? [{ key: "cases", icon: Box, tone: "warn" as const, text: t("{n} sets are not complete ({missing} expected items missing)", { n: incomplete.length, missing: incomplete.reduce((n, c) => n + c.comparison.missingTotal, 0) }), href: `${base}/sets` }]
      : incomplete.map((c) => ({ key: `c-${c.id}`, icon: Box, tone: "warn" as const, text: c.comparison.missingTotal === 1 ? t("{set}: 1 expected item not in the set", { set: c.name }) : t("{set}: {n} expected items not in the set", { set: c.name, n: c.comparison.missingTotal }), href: `/sets/${c.id}` }))),
    ...(loose > 0 && cases.length > 0 ? [{ key: "loose", icon: PackageOpen, tone: "neutral" as const, text: loose === 1 ? t("1 piece not in any set") : t("{n} pieces not in any set", { n: loose }), href: `${eq}&caseId=none` }] : []),
  ];
  const toneClass = { danger: "text-danger", warn: "text-warn", neutral: "text-muted" };

  return (
    <>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title={t("Needs attention")} />
            {attention.length === 0 ? (
              <p className="flex items-center gap-2 px-4 py-4 text-sm text-ok">
                <CircleCheck className="size-4" /> {t("All good — nothing missing, no open issues, cases complete.")}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {attention.map((a) => (
                  <li key={a.key}>
                    <Link href={a.href} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-2">
                      <a.icon className={cn("size-4 shrink-0", toneClass[a.tone])} aria-hidden />
                      <span className="line-clamp-2 min-w-0 flex-1">{a.text}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <section aria-label={t("Calendar")}>
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{t("Calendar")}</h2>
            <CalendarView ctx={ctx} projectId={projectId} basePath={base} month={month} add={add} canEdit={hasRole(ctx, "member")} showOverdue={false} />
          </section>

        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title={t("Sets")} action={<Link href={`${base}/sets`} className="text-xs text-muted hover:text-text">{t("All sets")}</Link>} />
            {cases.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted">
                {t("No sets yet.")}{" "}
                <Link href="/sets/new" className="text-accent hover:underline">
                  {t("Create one")}
                </Link>
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-px bg-border">
                {cases.map((c) => (
                  <li key={c.id} className="bg-surface">
                    <Link href={`/sets/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{c.name}</div>
                        <div className="text-xs text-muted">{c.code ?? c.templateName ?? " "}</div>
                      </div>
                      <div className="w-20 shrink-0 text-right">
                        <CaseProgress matched={c.comparison.matchedTotal} expected={c.comparison.expectedTotal} extra={c.comparison.extraTotal} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title={t("Recent activity")} action={<Link href={`${base}/history`} className="text-xs text-muted hover:text-text">{t("Full history")}</Link>} />
            <ActivityList events={activity} showProject={false} />
          </Card>
        </div>
      </div>
    </>
  );
}
