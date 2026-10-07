import { EquipmentBrowser, type BrowserParams } from "@/components/equipment-browser";
import { EmptyState, LinkButton } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { listCases } from "@/server/domain/cases";
import { getCategoryTree } from "@/server/domain/categories";
import { hasRole } from "@/server/domain/context";
import { listItems, type ItemFilters } from "@/server/domain/equipment-items";
import { getProjectSummary } from "@/server/domain/projects";
import { assertUuid, orNotFound } from "@/server/pages";
import { removeSelectionAction } from "../actions";

const LIMIT = 500;

/** The project's equipment: the same list as the Equipment tab, fixed to this project. */
export default async function ProjectEquipmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<BrowserParams> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  assertUuid(id);
  const ctx = await getCtx();
  const db = getDb();
  const { view: _view, location: _l, ...filters } = sp;
  const [items, { flat: categories }, cases, summary] = await Promise.all([
    listItems(db, ctx, { ...(filters as ItemFilters), projectId: id, limit: LIMIT }),
    getCategoryTree(db, ctx),
    listCases(db, ctx, { projectId: id }),
    orNotFound(getProjectSummary(db, ctx, id)),
  ]);
  return (
    <EquipmentBrowser
      basePath={`/projects/${id}`}
      sp={filters}
      items={items}
      limit={LIMIT}
      projectId={id}
      categories={categories}
      rentalHouses={summary.rentalHouses.map((r) => ({ id: r.id, name: r.name }))}
      cases={cases}
      hasFilters={Object.values(filters).some(Boolean)}
      removeAction={hasRole(ctx, "member") ? removeSelectionAction.bind(null, id) : undefined}
      empty={
        <EmptyState
          title="No equipment on this project yet"
          action={summary.project.status !== "closed" && <LinkButton href={`/projects/${id}/add-equipment`} variant="primary">Add equipment</LinkButton>}
        >
          Upload a delivery note, add equipment from the database or create new items.
        </EmptyState>
      }
    />
  );
}
