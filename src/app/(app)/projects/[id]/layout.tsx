import Link from "next/link";
import { Minus, Pencil, Plus } from "lucide-react";
import { ClientTabs } from "@/components/client-tabs";
import { LinkButton, PageHeader, ProjectStatusBadge, Stat } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { getFormat, getT } from "@/server/i18n";
import { assertUuid, orNotFound } from "@/server/pages";
import { getProjectSummary } from "@/server/domain/projects";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  assertUuid(id);
  const ctx = await getCtx();
  const { project, counts, rentalHouses } = await orNotFound(getProjectSummary(getDb(), ctx, id));
  const canEdit = hasRole(ctx, "member");
  const [t, f] = await Promise.all([getT(), getFormat()]);
  const base = `/projects/${id}`;
  return (
    <>
      <PageHeader
        back={{ href: "/projects", label: t("Projects") }}
        title={
          <span className="flex items-center gap-2">
            <span className="truncate">{project.name}</span>
            <ProjectStatusBadge status={project.status} />
          </span>
        }
        subtitle={[project.code, project.productionCompany, f.dateRange(project.startDate, project.endDate)].filter(Boolean).join(" · ")}
        actions={
          canEdit && (
            <>
              {project.status !== "closed" && (
                <LinkButton href={`${base}/add-equipment`} variant="primary">
                  <Plus className="size-4" /> {t("Add equipment")}
                </LinkButton>
              )}
              {counts.items > 0 && (
                <LinkButton href={`${base}/remove`}>
                  <Minus className="size-4" /> {t("Remove")}
                </LinkButton>
              )}
              <LinkButton href={`${base}/edit`}>
                <Pencil className="size-4" /> {t("Edit")}
              </LinkButton>
            </>
          )
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={counts.units === 1 ? t("piece") : t("pieces")} value={counts.units} />
        <Stat label={t("in use")} value={counts.in_use} />
        <Stat label={t("missing")} value={counts.missing} tone={counts.missing ? "danger" : undefined} href={`${base}?status=missing`} />
        <Stat label={t("open issues")} value={counts.open_issues} tone={counts.open_issues ? "warn" : undefined} href={`${base}/issues`} />
      </div>
      <section aria-label={t("Rental houses")} className="mb-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">{t("Rental houses")}</h2>
          {canEdit && (
            <Link href={`${base}/rental-houses`} className="text-xs text-muted hover:text-text">
              {t("Manage")}
            </Link>
          )}
        </div>
        {rentalHouses.length === 0 ? (
          <p className="text-sm text-muted">{t("No rental houses yet. They appear automatically when equipment is added.")}</p>
        ) : (
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {rentalHouses.map((rh) => (
              <li key={rh.id} className="shrink-0">
                <Link
                  href={`${base}?rentalHouseId=${rh.id}`}
                  className="block rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:border-ring/60"
                >
                  <div className="font-medium">{rh.short_name ?? rh.name}</div>
                  <div className="text-xs text-muted tabular-nums">
                    {t("{n} on project", { n: rh.on_project })}
                    {rh.returned > 0 && ` · ${t("{n} returned", { n: rh.returned })}`}
                    {rh.order_reference && ` · ${rh.order_reference}`}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <ClientTabs
        tabs={[
          { href: base, label: t("Equipment"), count: counts.units, exact: true },
          { href: `${base}/sets`, label: t("Sets"), count: counts.cases },
          { href: `${base}/documents`, label: t("Documents"), count: counts.documents },
          { href: `${base}/issues`, label: t("Issues"), count: counts.open_issues },
          { href: `${base}/history`, label: t("History") },
        ]}
      />
      {children}
    </>
  );
}
