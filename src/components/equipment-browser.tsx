import Link from "next/link";
import type { ReactNode } from "react";
import { Boxes, LayoutGrid, ListTree } from "lucide-react";
import { EQUIPMENT_SORTS, EquipmentByType, TypeGrid } from "@/components/equipment-by-type";
import { FilterBar, FilterSearch, FilterSelect } from "@/components/filters";
import { EmptyState } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { SelectionBar } from "@/components/select-tools";
import type { ActionState } from "@/server/actions";
import { STATUS_LABEL, cn } from "@/lib/format";
import type { CaseSummary } from "@/server/domain/cases";
import type { ItemRow } from "@/server/domain/equipment-items";

export type BrowserParams = {
  q?: string;
  categoryId?: string;
  rentalHouseId?: string;
  status?: string;
  location?: string;
  caseId?: string;
  view?: string;
  sort?: string;
  /** "1": select mode (ticks and bulk actions). */
  select?: string;
};

export type BrowserView = "types" | "sets" | "grid";

const VIEWS = [
  { key: "sets", label: "By set", Icon: Boxes },
  { key: "types", label: "By type", Icon: ListTree },
  { key: "grid", label: "Image view", Icon: LayoutGrid },
] as const;

const ON_PROJECT = ["on_project", "in_use", "ready_for_return", "missing"];

/** Grouped by set (default), one line per type, or one picture per type. */
export function browserView(sp: BrowserParams): BrowserView {
  return sp.view === "grid" ? "grid" : sp.view === "types" ? "types" : "sets";
}

/**
 * The one equipment list: used on the Equipment tab and on a project's page.
 * Same filters, set cards, views and actions; the project page just fixes the project.
 */
export function EquipmentBrowser({
  basePath,
  sp,
  items,
  limit,
  projectId,
  categories,
  rentalHouses,
  cases,
  hasFilters,
  bulkAction,
  empty,
}: {
  /** Where filter and view links point ("/equipment" or "/projects/<id>"). */
  basePath: string;
  sp: BrowserParams;
  items: ItemRow[];
  limit: number;
  /** The project in view (fixed on a project page, chosen on the Equipment tab); none = all projects. */
  projectId?: string;
  categories: { id: string; name: string; depth: number }[];
  rentalHouses: { id: string; name: string }[];
  cases: CaseSummary[];
  hasFilters: boolean;
  /** Bulk actions on ticked entries (needs a project in view). */
  bulkAction?: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  empty: ReactNode;
}) {
  const view = browserView(sp);
  const canSelect = Boolean(projectId && bulkAction);
  const selecting = canSelect && sp.select === "1" && view !== "grid";
  const href = (patch: Partial<BrowserParams>) => {
    const next = { ...sp, ...patch };
    if (next.view === "sets") delete next.view;
    const qs = new URLSearchParams(Object.entries(next).filter(([, x]) => x) as [string, string][]).toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const units = items.reduce((n, i) => n + i.quantity, 0);
  const count = new Set(items.map((i) => i.typeId)).size;
  const countLabel = count === 1 ? "type" : "types";

  return (
    <>
      {cases.length > 0 && (
        <section aria-label="Sets" className="mb-4">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Sets</h2>
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {[...cases.map((c) => ({ id: c.id, name: c.name, cmp: c.comparison as CaseSummary["comparison"] | null })), { id: "none", name: "Not in a set", cmp: null }].map((c) => {
              const active = sp.caseId === c.id;
              return (
                <li key={c.id} className="shrink-0">
                  <Link
                    href={href({ caseId: active ? "" : c.id })}
                    aria-current={active ? "true" : undefined}
                    className={cn("block rounded-lg border bg-surface px-3 py-2 text-sm", active ? "border-accent ring-1 ring-accent" : "border-border hover:border-ring/60")}
                  >
                    <div className="font-medium">▣ {c.name}</div>
                    <div className="text-xs text-muted tabular-nums">
                      {c.cmp
                        ? c.cmp.expectedTotal
                          ? `${c.cmp.matchedTotal} / ${c.cmp.expectedTotal}${c.cmp.extraTotal ? ` + ${c.cmp.extraTotal}` : ""}`
                          : `${c.cmp.matchedTotal + c.cmp.extraTotal} pcs`
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
          options={categories.map((c) => ({ value: c.id, label: `${" ".repeat(c.depth)}${c.name}` }))} />
        <FilterSelect name="rentalHouseId" label="Rental house" allLabel="All rental houses" value={sp.rentalHouseId}
          options={[...rentalHouses.map((r) => ({ value: r.id, label: r.name })), { value: "owned", label: "Owned (not rented)" }]} />
        <FilterSelect name="status" label="Status" allLabel="Any status" value={sp.status}
          options={Object.entries(STATUS_LABEL)
            .filter(([value]) => !projectId || ON_PROJECT.includes(value))
            .map(([value, label]) => ({ value, label }))} />
        <FilterSelect name="sort" label="Sort" allLabel="Sort: list order" value={sp.sort} options={[...EQUIPMENT_SORTS]} />
        {!projectId && (
          <FilterSelect name="location" label="Location" allLabel="Anywhere" value={sp.location}
            options={[{ value: "on_project", label: "On a project" }, { value: "off_project", label: "Not on a project" }]} />
        )}
      </FilterBar>

      {items.length === 0 ? (
        hasFilters ? <EmptyState title="No equipment matches these filters" /> : empty
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs text-muted">
              {items.length >= limit ? `Showing the first ${limit} — refine with filters` : `${count} ${countLabel} · ${units} ${units === 1 ? "unit" : "units"}`}
              {view !== "grid" && " · tap a line for serials and details"}
            </p>
            <div className="flex items-center gap-2">
            {canSelect && (
              <Link href={selecting ? href({ select: "" }) : href({ select: "1", view: view === "grid" ? "sets" : view })} className={cn("rounded-lg border px-2.5 py-1 text-xs", selecting ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-muted hover:text-text")}>
                {selecting ? "Done" : "Select"}
              </Link>
            )}
            <div className="flex rounded-lg border border-border bg-surface p-0.5" role="group" aria-label="View">
              {VIEWS.map(({ key, label, Icon }) => (
                <Link key={key} href={href({ view: key })} aria-label={label} title={label} aria-current={key === view ? "true" : undefined}
                  className={cn("rounded-md p-1.5", key === view ? "bg-accent-soft text-accent" : "text-muted hover:text-text")}>
                  <Icon className="size-4" />
                </Link>
              ))}
            </div>
            </div>
          </div>
          {view === "grid" ? (
            <BySet
              items={items}
              cases={cases}
              render={(its) => <TypeGrid items={its} sort={sp.sort} hrefFor={(typeName) => href({ view: "sets", q: typeName })} />}
            />
          ) : (
            (() => {
              const list =
                view === "sets" ? (
                  <BySet
                    items={items}
                    cases={cases}
                    render={(its, inSet) => (
                      <EquipmentByType items={its} sort={sp.sort} open={Boolean(sp.q || sp.caseId)} showProject={!projectId} selectable={selecting} hideSet={inSet} />
                    )}
                  />
                ) : (
                  <EquipmentByType items={items} sort={sp.sort} open={Boolean(sp.q || sp.caseId)} showProject={!projectId} selectable={selecting} />
                );
              return selecting && bulkAction ? (
                <ActionForm action={bulkAction}>
                  {list}
                  <SelectionBar sets={cases.map((c) => ({ value: c.id, label: c.name }))} />
                </ActionForm>
              ) : (
                list
              );
            })()
          )}
        </>
      )}
    </>
  );
}

/**
 * Grouped by set: one section per set (in the project's set order), then what is in no set.
 * `render` draws a group (type lines or pictures); `inSet` = it sits under a set heading.
 */
function BySet({ items, cases, render }: { items: ItemRow[]; cases: CaseSummary[]; render: (items: ItemRow[], inSet: boolean) => ReactNode }) {
  const groups = new Map<string, ItemRow[]>();
  for (const i of items) groups.set(i.caseId ?? "", [...(groups.get(i.caseId ?? "") ?? []), i]);
  const known = new Map(cases.map((c) => [c.id, c]));
  // Nothing packed in any set: just the list.
  if (groups.size === 1 && groups.has("")) return <>{render(items, false)}</>;
  const sections = [
    ...cases.filter((c) => groups.has(c.id)).map((c) => ({ id: c.id, name: c.name, cmp: c.comparison as CaseSummary["comparison"] | null })),
    // Sets of other projects (when no project is in view) by name.
    ...[...groups.keys()].filter((id) => id && !known.has(id)).map((id) => ({ id, name: groups.get(id)![0]!.caseName ?? "Set", cmp: null })),
    ...(groups.has("") ? [{ id: "", name: "Not in a set", cmp: null }] : []),
  ];
  return (
    <div className="space-y-4">
      {sections.map((sct) => {
        const its = groups.get(sct.id)!;
        const pcs = its.reduce((n, i) => n + i.quantity, 0);
        return (
          <section key={sct.id || "none"} aria-label={sct.name}>
            <h3 className="mb-1.5 flex items-baseline justify-between gap-2 px-1 text-sm">
              {sct.id ? (
                <Link href={`/sets/${sct.id}`} className="font-semibold hover:underline">
                  ▣ {sct.name}
                </Link>
              ) : (
                <span className="font-semibold text-muted">{sct.name}</span>
              )}
              <span className="text-xs text-muted tabular-nums">
                {sct.cmp?.expectedTotal ? `${sct.cmp.matchedTotal} / ${sct.cmp.expectedTotal}${sct.cmp.extraTotal ? ` + ${sct.cmp.extraTotal}` : ""}` : `${pcs} pcs`}
              </span>
            </h3>
            {render(its, Boolean(sct.id))}
          </section>
        );
      })}
    </div>
  );
}
