import Link from "next/link";
import { LayoutGrid, List, Plus } from "lucide-react";
import { EquipmentGrid, EquipmentTable, groupItems } from "@/components/equipment-table";
import { FilterBar, FilterSearch, FilterSelect } from "@/components/filters";
import { Tabs, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { STATUS_LABEL, cn } from "@/lib/format";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { getCategoryTree } from "@/server/domain/categories";
import { hasRole } from "@/server/domain/context";
import { listItems, type ItemFilters } from "@/server/domain/equipment-items";
import { listProjectOptions } from "@/server/domain/projects";
import { listRentalHouses } from "@/server/domain/rental-houses";
import { getCurrentProject } from "@/server/current-project";
import { ALL_PROJECTS } from "@/server/domain/current-project";

export const metadata = { title: "Equipment" };

type SP = { q?: string; categoryId?: string; rentalHouseId?: string; status?: string; projectId?: string; location?: string; view?: string };

export default async function EquipmentPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const db = getDb();
  // Without an explicit project filter the list shows the current project's equipment.
  const { current } = await getCurrentProject();
  const projectId = sp.projectId === ALL_PROJECTS ? undefined : (sp.projectId ?? (sp.location || sp.q ? undefined : current?.id));
  const focused = projectId && projectId === current?.id ? current : null;
  const grid = sp.view === "grid";
  const { view: _view, ...filterParams } = sp;
  const [items, { flat: categories }, rentalHouses, projects] = await Promise.all([
    listItems(db, ctx, { ...(filterParams as ItemFilters), projectId, limit: 300 }),
    getCategoryTree(db, ctx),
    listRentalHouses(db, ctx),
    listProjectOptions(db, ctx),
  ]);
  const hasFilters = Object.entries(filterParams).some(([k, v]) => v && !(k === "projectId" && v === current?.id));
  const viewHref = (v: "list" | "grid") => `/equipment?${new URLSearchParams(Object.entries({ ...sp, view: v === "grid" ? "grid" : "" }).filter(([, x]) => x) as [string, string][])}`;
  return (
    <>
      <PageHeader
        title={focused ? `Equipment · ${focused.name}` : "Equipment"}
        subtitle={
          focused ? (
            <>
              On the current project ·{" "}
              <Link href="/equipment?projectId=all" className="text-accent hover:underline">
                show all equipment
              </Link>
            </>
          ) : (
            "Every physical item, across all projects and rental houses"
          )
        }
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
        <FilterSelect name="projectId" label="Project" allLabel={current ? `Current project (${current.name})` : "All projects"} value={sp.projectId}
          options={[...(current ? [{ value: ALL_PROJECTS, label: "All projects" }] : []), ...projects.filter((p) => p.id !== current?.id).map((p) => ({ value: p.id, label: p.name }))]} />
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
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs text-muted">
              {items.length === 300 ? "Showing first 300 items — refine with filters" : (() => { const n = groupItems(items).length; const u = items.reduce((s, i) => s + i.quantity, 0); return `${n} ${n === 1 ? "entry" : "entries"} · ${u} ${u === 1 ? "unit" : "units"}`; })()}
            </p>
            <div className="flex rounded-lg border border-border bg-surface p-0.5" role="group" aria-label="View">
              {(["list", "grid"] as const).map((v) => {
                const Icon = v === "list" ? List : LayoutGrid;
                const active = (v === "grid") === grid;
                return (
                  <Link key={v} href={viewHref(v)} aria-label={v === "list" ? "List view" : "Image view"} aria-current={active ? "true" : undefined}
                    className={cn("rounded-md p-1.5", active ? "bg-accent-soft text-accent" : "text-muted hover:text-text")}>
                    <Icon className="size-4" />
                  </Link>
                );
              })}
            </div>
          </div>
          {grid ? <EquipmentGrid items={items} showProject={!projectId} /> : <EquipmentTable items={items} showProject={!projectId} />}
        </>
      )}
    </>
  );
}
