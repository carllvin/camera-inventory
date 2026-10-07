import { Plus } from "lucide-react";
import { CaseList } from "@/components/case-list";
import { LinkButton } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { listCases } from "@/server/domain/cases";
import { FilterBar, FilterSelect } from "@/components/filters";
import { SET_SORTS, sortSets } from "@/lib/sorting";
import { hasRole } from "@/server/domain/context";

export default async function ProjectCasesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sort?: string }> }) {
  const [{ id }, { sort }] = await Promise.all([params, searchParams]);
  const ctx = await getCtx();
  const cases = sortSets(await listCases(getDb(), ctx, { projectId: id }), sort);
  const newCase = hasRole(ctx, "member") && (
    <LinkButton href={`/sets/new?projectId=${id}`} variant="primary">
      <Plus className="size-4" /> New set
    </LinkButton>
  );
  return (
    <>
      {cases.length > 0 && newCase && <div className="mb-3 flex justify-end">{newCase}</div>}
      {cases.length > 1 && (
        <FilterBar hasFilters={false}>
          <FilterSelect name="sort" label="Sort" allLabel="Sort: name" value={sort} options={SET_SORTS.filter((o) => o.value !== "project")} />
        </FilterBar>
      )}
      <CaseList cases={cases} emptyAction={newCase} />
    </>
  );
}
