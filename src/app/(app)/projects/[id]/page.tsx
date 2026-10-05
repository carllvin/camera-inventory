import { EquipmentTable } from "@/components/equipment-table";
import { FilterBar, FilterSearch, FilterSelect } from "@/components/filters";
import { EmptyState, LinkButton } from "@/components/ui";
import { STATUS_LABEL } from "@/lib/format";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { getCategoryTree } from "@/server/domain/categories";
import { listItems } from "@/server/domain/equipment-items";
import { listCases } from "@/server/domain/cases";
import { getProjectSummary } from "@/server/domain/projects";
import { assertUuid, orNotFound } from "@/server/pages";

type SP = { q?: string; categoryId?: string; rentalHouseId?: string; status?: string; caseId?: string };

export default async function ProjectEquipmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  assertUuid(id);
  const ctx = await getCtx();
  const db = getDb();
  const [items, { flat: categories }, cases, summary] = await Promise.all([
    listItems(db, ctx, { ...sp, projectId: id, limit: 500 }),
    getCategoryTree(db, ctx),
    listCases(db, ctx, { projectId: id }),
    orNotFound(getProjectSummary(db, ctx, id)),
  ]);
  const hasFilters = Boolean(sp.q || sp.categoryId || sp.rentalHouseId || sp.status || sp.caseId);
  return (
    <>
      <FilterBar hasFilters={hasFilters}>
        <FilterSearch value={sp.q} placeholder="Search name, serial, asset…" />
        <FilterSelect
          name="categoryId"
          label="Category"
          allLabel="All categories"
          value={sp.categoryId}
          options={categories.map((c) => ({ value: c.id, label: `${" ".repeat(c.depth)}${c.name}` }))}
        />
        <FilterSelect
          name="rentalHouseId"
          label="Rental house"
          allLabel="All rental houses"
          value={sp.rentalHouseId}
          options={[...summary.rentalHouses.map((r) => ({ value: r.id, label: r.name })), { value: "owned", label: "Owned (not rented)" }]}
        />
        <FilterSelect
          name="status"
          label="Status"
          allLabel="Any status"
          value={sp.status}
          options={["on_project", "in_use", "ready_for_return", "missing"].map((s) => ({ value: s, label: STATUS_LABEL[s]! }))}
        />
        <FilterSelect
          name="caseId"
          label="Case"
          allLabel="Any case"
          value={sp.caseId}
          options={[{ value: "none", label: "Not in a case" }, ...cases.map((c) => ({ value: c.id, label: c.name }))]}
        />
      </FilterBar>
      {items.length === 0 ? (
        hasFilters ? (
          <EmptyState title="No equipment matches these filters" />
        ) : (
          <EmptyState
            title="No equipment on this project yet"
            action={summary.project.status !== "closed" && <LinkButton href={`/projects/${id}/add-equipment`} variant="primary">Add equipment</LinkButton>}
          >
            Add equipment from the database or create new items. Delivery-note import comes with document upload.
          </EmptyState>
        )
      ) : (
        <>
          <p className="mb-2 text-xs text-muted">
            {items.length} {items.length === 1 ? "item" : "items"}
          </p>
          <EquipmentTable items={items} showProject={false} />
        </>
      )}
    </>
  );
}
