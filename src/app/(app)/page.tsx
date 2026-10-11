import Link from "next/link";
import { ActivityList } from "@/components/activity";
import { IssueList } from "@/components/issues";
import { Card, CardHeader, EmptyState, LinkButton, PageHeader, ProjectStatusBadge, Stat } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { getDashboard } from "@/server/domain/overview";
import { listProjects } from "@/server/domain/projects";
import { getCurrentProject } from "@/server/current-project";
import { getFormat, getT } from "@/server/i18n";
import { ProjectDashboard } from "./project-dashboard";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Dashboard") };
}

export default async function DashboardPage() {
  const ctx = await getCtx();
  const { current } = await getCurrentProject();
  if (current) return <ProjectDashboard ctx={ctx} projectId={current.id} />;
  const db = getDb();
  const [{ counts, recent, issues }, projects] = await Promise.all([getDashboard(db, ctx), listProjects(db, ctx)]);
  const [t, f] = await Promise.all([getT(), getFormat()]);
  const active = projects.filter((p) => p.status !== "closed");
  return (
    <>
      <PageHeader title={t("Dashboard")} subtitle={ctx.workspaceName} />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label={t("Active projects")} value={counts.active_projects} href="/projects" />
        <Stat label={t("Items on projects")} value={counts.on_projects} href="/equipment?location=on_project" />
        <Stat label={t("In use")} value={counts.in_use} href="/equipment?status=in_use" />
        <Stat label={t("Missing")} value={counts.missing} tone={counts.missing ? "danger" : undefined} href="/equipment?status=missing" />
        <Stat label={t("Open issues")} value={counts.open_issues} tone={counts.open_issues ? "warn" : undefined} href="/issues" />
        <Stat label={t("Documents to review")} value={counts.pending_documents} href="/documents" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(0,24rem)]">
        <div className="space-y-6">
          <Card>
            <CardHeader title={t("Active projects")} action={<Link href="/projects" className="text-xs text-muted hover:text-text">{t("All projects")}</Link>} />
            {active.length === 0 ? (
              <div className="p-4">
                <EmptyState title={t("No active projects")} action={<LinkButton href="/projects/new" variant="primary">{t("New project")}</LinkButton>} />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {active.map((p) => (
                  <li key={p.id}>
                    <Link href={`/projects/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">{p.name}</span>
                          <ProjectStatusBadge status={p.status} />
                        </div>
                        <div className="text-xs text-muted">
                          {[p.code, f.dateRange(p.startDate, p.endDate)].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      <div className="text-right text-xs text-muted tabular-nums">
                        <div>
                          <span className="font-medium text-text">{p.itemCount}</span> {t("pieces")}
                        </div>
                        <div>{t("{n} rental houses", { n: p.rentalHouseCount })}</div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title={t("Recent activity")} action={<Link href="/history" className="text-xs text-muted hover:text-text">{t("Full history")}</Link>} />
            <ActivityList events={recent} />
          </Card>
        </div>
        <Card className="self-start">
          <CardHeader title={t("Open issues")} action={<Link href="/issues" className="text-xs text-muted hover:text-text">{t("All issues")}</Link>} />
          <IssueList issues={issues} compact />
        </Card>
      </div>
    </>
  );
}
