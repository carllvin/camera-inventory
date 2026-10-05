import Link from "next/link";
import { Plus } from "lucide-react";
import { EmptyState, LinkButton, PageHeader, ProjectStatusBadge } from "@/components/ui";
import { dateRange } from "@/lib/format";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { listProjects } from "@/server/domain/projects";

export const metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const ctx = await getCtx();
  const projects = await listProjects(getDb(), ctx);
  const canEdit = hasRole(ctx, "member");
  return (
    <>
      <PageHeader
        title="Projects"
        actions={
          canEdit && (
            <LinkButton href="/projects/new" variant="primary">
              <Plus className="size-4" /> New project
            </LinkButton>
          )
        }
      />
      {projects.length === 0 ? (
        <EmptyState title="No projects yet" action={canEdit && <LinkButton href="/projects/new" variant="primary">Create your first project</LinkButton>}>
          A project collects the equipment from all rental houses for one production.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/projects/${p.id}`} className="block h-full rounded-xl border border-border bg-surface p-4 hover:border-ring/60">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{p.name}</div>
                    <div className="text-xs text-muted">{[p.code, p.productionCompany].filter(Boolean).join(" · ") || " "}</div>
                  </div>
                  <ProjectStatusBadge status={p.status} />
                </div>
                <div className="mt-1 text-xs text-muted">{dateRange(p.startDate, p.endDate)}</div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-lg font-semibold tabular-nums">{p.itemCount}</div>
                    <div className="text-[11px] text-muted">items</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold tabular-nums">{p.rentalHouseCount}</div>
                    <div className="text-[11px] text-muted">rental houses</div>
                  </div>
                  <div>
                    <div className={`text-lg font-semibold tabular-nums ${p.openIssueCount ? "text-warn" : ""}`}>{p.openIssueCount}</div>
                    <div className="text-[11px] text-muted">open issues</div>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
