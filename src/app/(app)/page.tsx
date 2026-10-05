import Link from "next/link";
import { ActivityList } from "@/components/activity";
import { IssueList } from "@/components/issues";
import { Card, CardHeader, EmptyState, LinkButton, PageHeader, ProjectStatusBadge, Stat } from "@/components/ui";
import { dateRange } from "@/lib/format";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { getDashboard } from "@/server/domain/overview";
import { listProjects } from "@/server/domain/projects";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const ctx = await getCtx();
  const db = getDb();
  const [{ counts, recent, issues }, projects] = await Promise.all([getDashboard(db, ctx), listProjects(db, ctx)]);
  const active = projects.filter((p) => p.status !== "closed");
  return (
    <>
      <PageHeader title="Dashboard" subtitle={ctx.workspaceName} />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Active projects" value={counts.active_projects} href="/projects" />
        <Stat label="Items on projects" value={counts.on_projects} href="/equipment?location=on_project" />
        <Stat label="In use" value={counts.in_use} href="/equipment?status=in_use" />
        <Stat label="Missing" value={counts.missing} tone={counts.missing ? "danger" : undefined} href="/equipment?status=missing" />
        <Stat label="Open issues" value={counts.open_issues} tone={counts.open_issues ? "warn" : undefined} href="/issues" />
        <Stat label="Documents to review" value={counts.pending_documents} href="/documents" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(0,24rem)]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Active projects" action={<Link href="/projects" className="text-xs text-muted hover:text-text">All projects</Link>} />
            {active.length === 0 ? (
              <div className="p-4">
                <EmptyState title="No active projects" action={<LinkButton href="/projects/new" variant="primary">New project</LinkButton>} />
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
                          {[p.code, dateRange(p.startDate, p.endDate)].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      <div className="text-right text-xs text-muted tabular-nums">
                        <div>
                          <span className="font-medium text-text">{p.itemCount}</span> items
                        </div>
                        <div>{p.rentalHouseCount} rental houses</div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Recent activity" action={<Link href="/history" className="text-xs text-muted hover:text-text">Full history</Link>} />
            <ActivityList events={recent} />
          </Card>
        </div>
        <Card className="self-start">
          <CardHeader title="Open issues" action={<Link href="/issues" className="text-xs text-muted hover:text-text">All issues</Link>} />
          <IssueList issues={issues} compact />
        </Card>
      </div>
    </>
  );
}
