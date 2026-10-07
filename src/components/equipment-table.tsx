import Link from "next/link";
import { Camera } from "lucide-react";
import type { ItemRow } from "@/server/domain/equipment-items";
import { cn } from "@/lib/format";
import { groupUnits } from "@/lib/group-units";
import { ConditionBadge, Mono, StatusBadge } from "./ui";

function identifiers(i: ItemRow) {
  const parts: string[] = [];
  if (i.serialNumber) parts.push(`SN ${i.serialNumber}`);
  if (i.assetNumber) parts.push(`Asset ${i.assetNumber}`);
  return parts;
}

/** Small square product image (item photo or the type's reference image) on a neutral background. */
export function Thumb({ photoId, name, className }: { photoId: string | null; name: string; className?: string }) {
  return (
    <div className={cn("flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gradient-to-b from-white to-zinc-100 text-zinc-400", className)}>
      {photoId ? (
        // eslint-disable-next-line @next/next/no-img-element -- private, auth-checked images
        <img src={`/api/photos/${photoId}?size=thumb`} alt={name} loading="lazy" className="h-full w-full object-contain p-0.5 mix-blend-multiply" />
      ) : (
        <Camera className="size-5" strokeWidth={1.25} aria-hidden />
      )}
    </div>
  );
}

/** Items without a serial number of the same type, owner, place and state show as one row with their unit count. */
export function groupItems(items: ItemRow[]) {
  return groupUnits(items.map((i) => ({ ...i, equipmentTypeId: i.typeId })));
}

/** Equipment list: table on wide screens, stacked cards on phones. */
export function EquipmentTable({ items: rows, showProject = true }: { items: ItemRow[]; showProject?: boolean }) {
  const items = groupItems(rows);
  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border border-border bg-surface md:block">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-2/60 text-left text-xs text-muted">
            <tr>
              <th className="w-14 px-3 py-2 font-medium">
                <span className="sr-only">Image</span>
              </th>
              <th className="px-2 py-2 font-medium">Equipment</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Rental house</th>
              {showProject && <th className="px-3 py-2 font-medium">Project</th>}
              <th className="px-3 py-2 font-medium">Case</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((i) => (
              <tr key={i.id} className="group relative hover:bg-surface-2/60">
                <td className="px-3 py-1.5">
                  <Thumb photoId={i.imageId} name={i.typeName} />
                </td>
                <td className="px-2 py-2">
                  <Link href={`/equipment/${i.id}`} className="font-medium after:absolute after:inset-0">
                    {i.typeName}
                  </Link>
                  <div className="text-xs text-muted">
                    <Mono>{identifiers(i).join(" · ") || "No serial"}</Mono>
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{i.units}</td>
                <td className="px-3 py-2 text-muted">{i.categoryName ?? "—"}</td>
                <td className="px-3 py-2">{i.rentalHouseShort ?? i.rentalHouseName ?? <span className="text-muted">Owned</span>}</td>
                {showProject && <td className="px-3 py-2">{i.projectName ?? <span className="text-muted">—</span>}</td>}
                <td className="px-3 py-2">{i.caseName ?? <span className="text-muted">—</span>}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-col items-start gap-1">
                    <StatusBadge status={i.status} />
                    <ConditionBadge condition={i.condition} hideOk />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-2 md:hidden">
        {items.map((i) => (
          <li key={i.id}>
            <Link href={`/equipment/${i.id}`} className="flex gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 active:bg-surface-2">
              <Thumb photoId={i.imageId} name={i.typeName} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {i.units > 1 && <span className="tabular-nums">{i.units} × </span>}
                      {i.typeName}
                    </div>
                    <div className="text-xs text-muted">
                      <Mono>{identifiers(i).join(" · ") || "No serial"}</Mono>
                    </div>
                  </div>
                  <StatusBadge status={i.status} />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                  <span>{i.rentalHouseShort ?? i.rentalHouseName ?? "Owned"}</span>
                  {showProject && i.projectName && <span>{i.projectName}</span>}
                  {i.caseName && <span>▣ {i.caseName}</span>}
                  <ConditionBadge condition={i.condition} hideOk />
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Image view: product pictures first, for recognising equipment at a glance. */
export function EquipmentGrid({ items: rows, showProject = true }: { items: ItemRow[]; showProject?: boolean }) {
  const items = groupItems(rows);
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((i) => (
        <li key={i.id}>
          <Link href={`/equipment/${i.id}`} className="block h-full overflow-hidden rounded-xl border border-border bg-surface hover:border-ring/60">
            <div className="relative flex aspect-[4/3] items-center justify-center bg-gradient-to-b from-white to-zinc-100 text-zinc-400">
              {i.imageId ? (
                // eslint-disable-next-line @next/next/no-img-element -- private, auth-checked images
                <img src={`/api/photos/${i.imageId}?size=thumb`} alt={i.typeName} loading="lazy" className="h-full w-full object-contain p-2 mix-blend-multiply" />
              ) : (
                <Camera className="size-10" strokeWidth={1.25} aria-hidden />
              )}
              {i.units > 1 && <span className="absolute top-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-xs font-medium text-white tabular-nums">× {i.units}</span>}
            </div>
            <div className="space-y-1 p-3">
              <div className="line-clamp-2 text-sm font-medium">{i.typeName}</div>
              <div className="truncate text-xs text-muted">
                <Mono>{identifiers(i).join(" · ") || "No serial"}</Mono>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge status={i.status} />
                <ConditionBadge condition={i.condition} hideOk />
              </div>
              <div className="truncate text-xs text-muted">
                {[i.caseName && `▣ ${i.caseName}`, showProject && i.projectName, i.rentalHouseShort ?? i.rentalHouseName].filter(Boolean).join(" · ")}
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
