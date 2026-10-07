import Link from "next/link";
import { Camera, ChevronRight } from "lucide-react";
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
              <ul className="divide-y divide-border border-t border-border bg-surface-2/40">
                {entries.map((e) => (
                  <li key={e.id} className="flex py-2 pr-3 pl-[4.25rem] hover:bg-surface-2">
                    <EntryBody e={e} showProject={showProject} />
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

/** Image view: one card per equipment type with its quantity (opens that type in the list). */
export function TypeGrid({ items, hrefFor }: { items: ItemRow[]; hrefFor: (typeName: string) => string }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {byType(items).map((g) => {
        const statuses = statusSummary(g.items);
        return (
          <li key={g.typeId}>
            <Link href={hrefFor(g.typeName)} className="block h-full overflow-hidden rounded-xl border border-border bg-surface hover:border-ring/60">
              <div className="relative flex aspect-[4/3] items-center justify-center bg-gradient-to-b from-white to-zinc-100 text-zinc-400">
                {g.imageId ? (
                  // eslint-disable-next-line @next/next/no-img-element -- private, auth-checked images
                  <img src={`/api/photos/${g.imageId}?size=thumb`} alt={g.typeName} loading="lazy" className="h-full w-full object-contain p-2 mix-blend-multiply" />
                ) : (
                  <Camera className="size-10" strokeWidth={1.25} aria-hidden />
                )}
                <span className="absolute top-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-xs font-medium text-white tabular-nums">× {g.units}</span>
              </div>
              <div className="space-y-0.5 p-3">
                <div className="line-clamp-2 text-sm font-medium">{g.typeName}</div>
                <div className="truncate text-xs text-muted">{g.categoryName ?? " "}</div>
                {statuses.length > 0 && (
                  <div className="flex flex-wrap gap-x-2 text-xs">
                    {statuses.map((s) => (
                      <span key={s.status} className={s.status === "missing" ? "font-medium text-danger" : "text-text"}>
                        {s.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
