import { Plus } from "lucide-react";
import { CaseList } from "@/components/case-list";
import { LinkButton, PageHeader, Tabs } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { listCases } from "@/server/domain/cases";
import { getCurrentProject } from "@/server/current-project";
import { FilterBar, FilterSelect } from "@/components/filters";
import { SET_SORTS, sortSets } from "@/lib/sorting";
import { hasRole } from "@/server/domain/context";
import { getT } from "@/server/i18n";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Sets") };
}

export default async function CasesPage({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  const { sort } = await searchParams;
  const ctx = await getCtx();
  const { current } = await getCurrentProject();
  const cases = sortSets(await listCases(getDb(), ctx, { projectId: current?.id }), sort);
  const canEdit = hasRole(ctx, "member");
  const t = await getT();
  return (
    <>
      <PageHeader
        title={t("Sets")}
        subtitle={current ? t("Sets of {project}", { project: current.name }) : t("Expected vs. packed contents across all projects")}
        actions={canEdit && <LinkButton href="/sets/new" variant="primary"><Plus className="size-4" /> {t("New set")}</LinkButton>}
      />
      <Tabs active="cases" tabs={[{ key: "cases", href: "/sets", label: t("Sets") }, { key: "templates", href: "/sets/templates", label: t("Templates") }]} />
      {cases.length > 1 && (
        <FilterBar hasFilters={false}>
          <FilterSelect name="sort" label={t("Sort")} allLabel={t("Sort: name")} value={sort} options={SET_SORTS.filter((o) => o.value !== "project" || !current).map((o) => ({ value: o.value, label: o.value === "progress" ? t("Sort: incomplete first") : t("Sort: project") }))} />
        </FilterBar>
      )}
      <CaseList cases={cases} showProject={!current} emptyAction={canEdit && <LinkButton href="/sets/new" variant="primary">{t("New set")}</LinkButton>} />
    </>
  );
}
