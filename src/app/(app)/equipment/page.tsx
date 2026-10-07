import Link from "next/link";
import { LayoutGrid, List, ListTree, Plus } from "lucide-react";
import { EquipmentByType } from "@/components/equipment-by-type";
import { EquipmentGrid, EquipmentTable, groupItems } from "@/components/equipment-table";
import { FilterBar, FilterSearch, FilterSelect } from "@/components/filters";
import { Tabs, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { STATUS_LABEL, cn } from "@/lib/format";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { getCategoryTree } from "@/server/domain/categories";
import { listCases } from "@/server/domain/cases";
import { hasRole } from "@/server/domain/context";
import { listItems, type ItemFilters } from "@/server/domain/equipment-items";
import { listProjectOptions } from "@/server/domain/projects";
import { listRentalHouses } from "@/server/domain/rental-houses";
import { getCurrentProject } from "@/server/current-project";
import { ALL_PROJECTS } from "@/server/domain/current-project";

export const metadata = { title: "Equipment" };

type SP = { q?: string; categoryId?: string; rentalHouseId?: string; status?: string; projectId?: string; location?: string; caseId?: string; view?: string };

export default async function EquipmentPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const db = getDb();
  // Without an explicit project filter the list shows the current project's equipment.
  const { current } = await getCurrentProject();
  const projectId = sp.projectId === ALL_PROJECTS ? undefined : (sp.projectId ?? (sp.location || sp.q ? undefined : current?.id));
  const focused = projectId && projectId === current?.id ? current : null;
  const view = sp.view === "grid" || sp.view === "types" ? sp.view : "list";
  const { view: _view, ...filterParams } = sp;
  const [items, { flat: categories }, rentalHouses, projects, cases] = await Promise.all([
    listItems(db, ctx, { ...(filterParams as ItemFilters), projectId, limit: 300 }),
    getCategoryTree(db, ctx),
    listRentalHouses(db, ctx),
    listProjectOptions(db, ctx),
    projectId ? listCases(db, ctx, { projectId }) : Promise.resolve([]),
  ]);
  // Case cards filter the list; tapping the active one shows everything again.
  const caseHref = (caseId: string) =>
    `/equipment?${new URLSearchParams(Object.entries({ ...sp, caseId: sp.caseId === caseId ? "" : caseId }).filter(([, x]) => x) as [string, string][])}`;
  const hasFilters = Object.entries(filterParams).some(([k, v]) => v && !(k === "projectId" && v === current?.id));
  const viewHref = (v: "list" | "grid" | "types") => `/equipment?${new URLSearchParams(Object.entries({ ...sp, view: v === "list" ? "" : v }).filter(([, x]) => x) as [string, string][])}`;
  const VIEWS = [
    { key: "list", label: "List view", Icon: List },
    { key: "grid", label: "Image view", Icon: LayoutGrid },
    { key: "types", label: "By type", Icon: ListTree },
  ] as const;
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
      {cases.length > 0 && (
        <section aria-label="Sets" className="mb-4">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Sets</h2>
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {[...cases.map((c) => ({ id: c.id, name: c.name, units: c.comparison.matchedTotal + c.comparison.extraTotal, cmp: c.comparison })), { id: "none", name: "Not in a set", units: null, cmp: null }].map((c) => {
              const active = sp.caseId === c.id;
              return (
                <li key={c.id} className="shrink-0">
                  <Link
                    href={caseHref(c.id)}
                    aria-current={active ? "true" : undefined}
                    className={cn("block rounded-lg border bg-surface px-3 py-2 text-sm", active ? "border-accent ring-1 ring-accent" : "border-border hover:border-ring/60")}
                  >
                    <div className="font-medium">▣ {c.name}</div>
                    <div className="text-xs text-muted tabular-nums">
                      {c.cmp
                        ? c.cmp.expectedTotal
                          ? `${c.cmp.matchedTotal} / ${c.cmp.expectedTotal}${c.cmp.extraTotal ? ` + ${c.cmp.extraTotal}` : ""}`
                          : `${c.units} pcs`
                        : "loose equipment"}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
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
              {items.length === 300 ? "Showing first 300 items — refine with filters" : (() => {
                    const u = items.reduce((s, i) => s + i.quantity, 0);
                    const n = view === "types" ? new Set(items.map((i) => i.typeId)).size : groupItems(items).length;
                    const what = view === "types" ? (n === 1 ? "type" : "types") : n === 1 ? "entry" : "entries";
                    return `${n} ${what} · ${u} ${u === 1 ? "unit" : "units"}`;
                  })()}
            </p>
            <div className="flex rounded-lg border border-border bg-surface p-0.5" role="group" aria-label="View">
              {VIEWS.map(({ key, label, Icon }) => {
                const active = key === view;
                return (
                  <Link key={key} href={viewHref(key)} aria-label={label} title={label} aria-current={active ? "true" : undefined}
                    className={cn("rounded-md p-1.5", active ? "bg-accent-soft text-accent" : "text-muted hover:text-text")}>
                    <Icon className="size-4" />
                  </Link>
                );
              })}
            </div>
          </div>
          {view === "grid" ? (
            <EquipmentGrid items={items} showProject={!projectId} />
          ) : view === "types" ? (
            <EquipmentByType items={items} open={Boolean(sp.q)} showProject={!projectId} />
          ) : (
            <EquipmentTable items={items} showProject={!projectId} />
          )}
        </>
      )}
    </>
  );
}
