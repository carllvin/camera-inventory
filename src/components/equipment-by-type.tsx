import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ItemRow } from "@/server/domain/equipment-items";
import { STATUS_LABEL } from "@/lib/format";
import { groupItems, Thumb } from "./equipment-table";
import { ConditionBadge, Mono, StatusBadge } from "./ui";

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

/**
 * One line per equipment type with its quantity; opening it shows the single
 * entries (serials, asset numbers, case, owner, state, notes).
 */
export function EquipmentByType({ items, open = false, showProject = false }: { items: ItemRow[]; open?: boolean; showProject?: boolean }) {
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
                    {cases.length > 0 && <span>▣ {cases.length === 1 ? cases[0] : `${cases.length} cases`}</span>}
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
              <ul className="divide-y divide-border border-t border-border bg-surface-2/40">
                {entries.map((e) => (
                  <li key={e.id}>
                    <Link href={`/equipment/${e.id}`} className="flex items-start gap-3 py-2 pr-3 pl-[4.25rem] hover:bg-surface-2">
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
                  </li>
                ))}
              </ul>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
