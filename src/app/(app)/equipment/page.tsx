import { Plus } from "lucide-react";
import { EquipmentTable } from "@/components/equipment-table";
import { FilterBar, FilterSearch, FilterSelect } from "@/components/filters";
import { Tabs, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { STATUS_LABEL } from "@/lib/format";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { getCategoryTree } from "@/server/domain/categories";
import { hasRole } from "@/server/domain/context";
import { listItems, type ItemFilters } from "@/server/domain/equipment-items";
import { listProjectOptions } from "@/server/domain/projects";
import { listRentalHouses } from "@/server/domain/rental-houses";

export const metadata = { title: "Equipment" };

type SP = { q?: string; categoryId?: string; rentalHouseId?: string; status?: string; projectId?: string; location?: string };

export default async function EquipmentPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const db = getDb();
  const [items, { flat: categories }, rentalHouses, projects] = await Promise.all([
    listItems(db, ctx, { ...(sp as ItemFilters), limit: 300 }),
    getCategoryTree(db, ctx),
    listRentalHouses(db, ctx),
    listProjectOptions(db, ctx),
  ]);
  const hasFilters = Object.values(sp).some(Boolean);
  return (
    <>
      <PageHeader
        title="Equipment"
        subtitle="Every physical item, across all projects and rental houses"
        actions={
          hasRole(ctx, "member") && (
            <LinkButton href="/equipment/new" variant="primary">
              <Plus className="size-4" /> Add equipment
            </LinkButton>
          )
        }
      />
      <Tabs
        active="items"
        tabs={[
          { key: "items", href: "/equipment", label: "Items" },
          { key: "types", href: "/equipment/types", label: "Equipment types" },
        ]}
      />
      <FilterBar hasFilters={hasFilters}>
        <FilterSearch value={sp.q} placeholder="Name, alias, serial, asset, barcode…" />
        <FilterSelect name="categoryId" label="Category" allLabel="All categories" value={sp.categoryId}
          options={categories.map((c) => ({ value: c.id, label: `${" ".repeat(c.depth)}${c.name}` }))} />
        <FilterSelect name="rentalHouseId" label="Rental house" allLabel="All rental houses" value={sp.rentalHouseId}
          options={[...rentalHouses.map((r) => ({ value: r.id, label: r.name })), { value: "owned", label: "Owned (not rented)" }]} />
        <FilterSelect name="projectId" label="Project" allLabel="All projects" value={sp.projectId}
          options={projects.map((p) => ({ value: p.id, label: p.name }))} />
        <FilterSelect name="status" label="Status" allLabel="Any status" value={sp.status}
          options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))} />
        <FilterSelect name="location" label="Location" allLabel="Anywhere" value={sp.location}
          options={[{ value: "on_project", label: "On a project" }, { value: "off_project", label: "Not on a project" }]} />
      </FilterBar>
      {items.length === 0 ? (
        <EmptyState title={hasFilters ? "No equipment matches" : "No equipment yet"}
          action={!hasFilters && hasRole(ctx, "member") && <LinkButton href="/equipment/new" variant="primary">Add equipment</LinkButton>} />
      ) : (
        <>
          <p className="mb-2 text-xs text-muted">{items.length === 300 ? "Showing first 300 items — refine with filters" : `${items.length} items`}</p>
          <EquipmentTable items={items} />
        </>
      )}
    </>
  );
}
