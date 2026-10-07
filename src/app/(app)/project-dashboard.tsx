import Link from "next/link";
import { AlertTriangle, Box, CircleCheck, FileText, PackageOpen, Search, Wrench } from "lucide-react";
import { ActivityList } from "@/components/activity";
import { CaseProgress } from "@/components/case-list";
import { Card, CardHeader, LinkButton, ProjectStatusBadge, Stat } from "@/components/ui";
import { cn, dateRange, DOCUMENT_KIND_LABEL, todayIso } from "@/lib/format";
import { projectTimeline } from "@/lib/project-timeline";
import { getDb } from "@/server/db/client";
import { listCases } from "@/server/domain/cases";
import type { Ctx } from "@/server/domain/context";
import { listItems } from "@/server/domain/equipment-items";
import { listActivity, listDocuments, listIssues } from "@/server/domain/overview";
import { getProjectSummary } from "@/server/domain/projects";

type Attention = { key: string; icon: typeof Box; tone: "danger" | "warn" | "neutral"; text: string; href: string };

/** Start page while a project is in focus: where it stands and what needs doing. */
export async function ProjectDashboard({ ctx, projectId }: { ctx: Ctx; projectId: string }) {
  const db = getDb();
  const [{ project, counts, rentalHouses }, items, cases, issues, documents, activity] = await Promise.all([
    getProjectSummary(db, ctx, projectId),
    listItems(db, ctx, { projectId, limit: 500 }),
    listCases(db, ctx, { projectId }),
    listIssues(db, ctx, { projectId, openOnly: true, limit: 20 }),
    listDocuments(db, ctx, { projectId }),
    listActivity(db, ctx, { projectId, limit: 12 }),
  ]);
  const base = `/projects/${projectId}`;
  const timeline = projectTimeline(project.startDate, project.endDate, todayIso());

  const missing = items.filter((i) => i.status === "missing");
  const broken = items.filter((i) => i.condition === "damaged" || i.condition === "defective");
  const toReview = documents.filter((d) => ["uploaded", "processing", "extracted", "failed"].includes(d.status));
  const incomplete = cases.filter((c) => c.comparison.missingTotal > 0);
  const loose = items.filter((i) => !i.caseId).reduce((n, i) => n + i.quantity, 0);
  const label = (i: (typeof items)[number]) => `${i.typeName}${i.serialNumber ? ` (SN ${i.serialNumber})` : i.quantity > 1 ? ` × ${i.quantity}` : ""}`;

  const attention: Attention[] = [
    ...missing.slice(0, 5).map((i) => ({ key: `m-${i.id}`, icon: Search, tone: "danger" as const, text: `Missing: ${label(i)}`, href: `/equipment/${i.id}` })),
    ...(missing.length > 5 ? [{ key: "m-more", icon: Search, tone: "danger" as const, text: `${missing.length - 5} more missing`, href: `${base}?status=missing` }] : []),
    ...broken.slice(0, 5).map((i) => ({ key: `b-${i.id}`, icon: Wrench, tone: "warn" as const, text: `${i.condition === "defective" ? "Defective" : "Damaged"}: ${label(i)}`, href: `/equipment/${i.id}` })),
    ...(issues.length ? [{ key: "issues", icon: AlertTriangle, tone: "warn" as const, text: `${issues.length} open issue${issues.length === 1 ? "" : "s"}${issues[0] ? ` — ${issues[0].title}${issues.length > 1 ? " …" : ""}` : ""}`, href: `${base}/issues` }] : []),
    ...toReview.map((d) => ({
      key: `d-${d.id}`,
      icon: FileText,
      tone: "neutral" as const,
      text: `${d.status === "failed" ? "Could not be read" : d.status === "processing" ? "Being read" : "To review"}: ${DOCUMENT_KIND_LABEL[d.kind] ?? d.kind} ${d.documentNumber ?? d.title ?? ""}${d.rentalHouseName ? ` · ${d.rentalHouseName}` : ""}`,
      href: `/documents/${d.id}`,
    })),
    ...(incomplete.length > 3
      ? [{ key: "cases", icon: Box, tone: "warn" as const, text: `${incomplete.length} cases are not complete (${incomplete.reduce((n, c) => n + c.comparison.missingTotal, 0)} expected items missing)`, href: `${base}/cases` }]
      : incomplete.map((c) => ({ key: `c-${c.id}`, icon: Box, tone: "warn" as const, text: `${c.name}: ${c.comparison.missingTotal} expected item${c.comparison.missingTotal === 1 ? "" : "s"} not in the case`, href: `/cases/${c.id}` }))),
    ...(loose > 0 && cases.length > 0 ? [{ key: "loose", icon: PackageOpen, tone: "neutral" as const, text: `${loose} piece${loose === 1 ? "" : "s"} not in any case`, href: `/equipment?caseId=none` }] : []),
  ];
  const toneClass = { danger: "text-danger", warn: "text-warn", neutral: "text-muted" };

  return (
    <>
      <header className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          <ProjectStatusBadge status={project.status} />
        </div>
        <p className="mt-1 text-sm text-muted">
          {[project.code, project.productionCompany, dateRange(project.startDate, project.endDate)].filter(Boolean).join(" · ")}
          {timeline && (
            <>
              {" · "}
              <span className={cn("font-medium", timeline.tone === "danger" ? "text-danger" : timeline.tone === "warn" ? "text-warn" : "text-text")}>{timeline.text}</span>
            </>
          )}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <LinkButton href={base}>Equipment</LinkButton>
          <LinkButton href={`${base}/cases`}>Cases</LinkButton>
          <LinkButton href="/documents/new">Upload a note</LinkButton>
        </div>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={counts.units !== counts.items ? `units (${counts.items} entries)` : "items"} value={counts.units} href={base} />
        <Stat label="in use" value={counts.in_use} href={`${base}?status=in_use`} />
        <Stat label="missing" value={counts.missing} tone={counts.missing ? "danger" : undefined} href={`${base}?status=missing`} />
        <Stat label="open issues" value={counts.open_issues} tone={counts.open_issues ? "warn" : undefined} href={`${base}/issues`} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Needs attention" />
            {attention.length === 0 ? (
              <p className="flex items-center gap-2 px-4 py-4 text-sm text-ok">
                <CircleCheck className="size-4" /> All good — nothing missing, no open issues, cases complete.
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

          <Card>
            <CardHeader title="Cases" action={<Link href={`${base}/cases`} className="text-xs text-muted hover:text-text">All cases</Link>} />
            {cases.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted">
                No cases yet. <Link href="/cases/new" className="text-accent hover:underline">Create one</Link>
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2">
                {cases.map((c) => (
                  <li key={c.id} className="bg-surface">
                    <Link href={`/cases/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
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
            <CardHeader title="Recent activity" action={<Link href={`${base}/history`} className="text-xs text-muted hover:text-text">Full history</Link>} />
            <ActivityList events={activity} showProject={false} />
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Rental houses" />
            {rentalHouses.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted">No rental houses yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {rentalHouses.map((rh) => (
                  <li key={rh.id}>
                    <Link href={`${base}?rentalHouseId=${rh.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{rh.short_name ?? rh.name}</div>
                        <div className="text-xs text-muted">{[rh.order_reference, rh.contact_name].filter(Boolean).join(" · ") || " "}</div>
                      </div>
                      <div className="text-right text-xs tabular-nums">
                        <div>
                          <span className="font-medium">{rh.on_project}</span> <span className="text-muted">out</span>
                        </div>
                        {rh.returned > 0 && <div className="text-muted">{rh.returned} returned</div>}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <p className="text-center text-xs text-muted">
            Showing the current project. Switch to <span className="font-medium">All projects</span> in the header for the workspace overview.
          </p>
        </div>
      </div>
    </>
  );
}
