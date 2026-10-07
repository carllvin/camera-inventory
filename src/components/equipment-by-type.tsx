import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ItemRow } from "@/server/domain/equipment-items";
import { STATUS_LABEL } from "@/lib/format";
import { groupItems, Thumb } from "./equipment-table";
import { ConditionBadge, Mono, StatusBadge } from "./ui";

/** Ticking entries inside a type line to start removing them from the project. */
export type TypeLineActions = { remove: (fd: FormData) => Promise<void> };

type TypeGroup = { typeId: string; typeName: string; categoryName: string | null; imageId: string | null; items: ItemRow[]; units: number };

function byType(items: ItemRow[]) {
  const groups = new Map<string, TypeGroup>();
  for (const i of items) {
    const g = groups.get(i.typeId) ?? { typeId: i.typeId, typeName: i.typeName, categoryName: i.categoryName, imageId: null, items: [], units: 0 };
    g.items.push(i);
    g.units += i.quantity;
    g.imageId ??= i.imageId;
    groups.set(i.typeId, g);
  }
  return [...groups.values()];
}

/** "2 in use · 1 missing": everything that is not plainly on the project. */
function statusSummary(items: ItemRow[]) {
  const counts = new Map<string, number>();
  for (const i of items) if (i.status !== "on_project") counts.set(i.status, (counts.get(i.status) ?? 0) + i.quantity);
  return [...counts].map(([s, n]) => ({ status: s, label: `${n} ${STATUS_LABEL[s]?.toLowerCase() ?? s}` }));
}

const where = (i: ItemRow, showProject: boolean) =>
  [showProject && (i.projectName ?? "Not on a project"), i.caseName && `▣ ${i.caseName}`, i.rentalHouseShort ?? i.rentalHouseName ?? "Owned"].filter(Boolean).join(" · ");

type Entry = ReturnType<typeof groupItems>[number];

/** Serial / asset / barcode, place, notes and state of one entry, linking to it. */
function EntryBody({ e, showProject }: { e: Entry; showProject: boolean }) {
  return (
    <Link href={`/equipment/${e.id}`} className="flex min-w-0 flex-1 items-start gap-3 hover:text-accent">
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex flex-wrap gap-x-3">
          <Mono>{e.serialNumber ? `SN ${e.serialNumber}` : e.units > 1 ? `${e.units} pcs · no serial` : "No serial"}</Mono>
          {e.assetNumber && <span className="text-muted"><Mono>Asset {e.assetNumber}</Mono></span>}
          {e.barcode && <span className="text-muted"><Mono>Code {e.barcode}</Mono></span>}
        </div>
        <div className="text-xs text-muted">{where(e, showProject)}</div>
        {e.notes && <div className="mt-0.5 line-clamp-2 text-xs text-muted italic">{e.notes}</div>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <StatusBadge status={e.status} />
        <ConditionBadge condition={e.condition} hideOk />
      </div>
    </Link>
  );
}

/**
 * One line per equipment type with its quantity; opening it shows the single
 * entries (serials, asset numbers, case, owner, state, notes).
 */
export function EquipmentByType({ items, open = false, showProject = false, actions }: { items: ItemRow[]; open?: boolean; showProject?: boolean; actions?: TypeLineActions }) {
  const groups = byType(items);
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
      {groups.map((g) => {
        const statuses = statusSummary(g.items);
        const damaged = g.items.filter((i) => i.condition !== "ok" && i.condition !== "unknown").reduce((n, i) => n + i.quantity, 0);
        const cases = [...new Set(g.items.map((i) => i.caseName).filter(Boolean))];
        const entries = groupItems(g.items);
        return (
          <li key={g.typeId}>
            <details className="group" open={open || undefined}>
              <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2 hover:bg-surface-2/60 [&::-webkit-details-marker]:hidden">
                <Thumb photoId={g.imageId} name={g.typeName} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{g.typeName}</div>
                  <div className="flex flex-wrap gap-x-2 text-xs text-muted">
                    {g.categoryName && <span>{g.categoryName}</span>}
                    {cases.length > 0 && <span>▣ {cases.length === 1 ? cases[0] : `${cases.length} sets`}</span>}
                    {statuses.map((s) => (
                      <span key={s.status} className={s.status === "missing" ? "font-medium text-danger" : "text-text"}>
                        {s.label}
                      </span>
                    ))}
                    {damaged > 0 && <span className="text-warn">{damaged} damaged</span>}
                  </div>
                </div>
                <span className="text-sm font-semibold tabular-nums" aria-label={`Quantity ${g.units}`}>
                  {g.units}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted transition-transform group-open:rotate-90" aria-hidden />
              </summary>
              {actions ? (
                <form action={actions.remove} className="border-t border-border bg-surface-2/40">
                  <ul className="divide-y divide-border">
                    {entries.map((e) => (
                      <li key={e.id} className="flex items-start gap-3 py-2 pr-3 pl-3 sm:pl-6">
                        <input type="checkbox" name="row" value={e.id} aria-label={`Select ${e.serialNumber ? `SN ${e.serialNumber}` : g.typeName}`} className="mt-1 size-4 shrink-0" />
                        <input type="hidden" name={`ids_${e.id}`} value={e.itemIds.join(",")} />
                        <EntryBody e={e} showProject={showProject} />
                        {e.units > 1 && (
                          <input type="number" name={`units_${e.id}`} min={1} max={e.units} defaultValue={e.units} inputMode="numeric"
                            aria-label={`How many (of ${e.units})`} className="w-14 shrink-0 rounded-md border border-border bg-surface px-1.5 py-1 text-right text-xs tabular-nums" />
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2 sm:pl-6">
                    <span className="text-xs text-muted">Ticked:</span>
                    <button type="submit" formNoValidate className="ml-auto text-xs text-muted hover:text-danger">
                      Remove from project…
                    </button>
                  </div>
                </form>
              ) : (
              <ul className="divide-y divide-border border-t border-border bg-surface-2/40">
                {entries.map((e) => (
                  <li key={e.id} className="flex py-2 pr-3 pl-[4.25rem] hover:bg-surface-2">
                    <EntryBody e={e} showProject={showProject} />
                  </li>
                ))}
              </ul>
              )}
            </details>
          </li>
        );
      })}
    </ul>
  );
}
