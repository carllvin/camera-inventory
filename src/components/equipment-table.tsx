import Link from "next/link";
import type { ItemRow } from "@/server/domain/equipment-items";
import { ConditionBadge, Mono, StatusBadge } from "./ui";

function identifiers(i: ItemRow) {
  const parts: string[] = [];
  if (i.serialNumber) parts.push(`SN ${i.serialNumber}`);
  if (i.assetNumber) parts.push(`Asset ${i.assetNumber}`);
  if (i.trackingMode === "bulk") parts.push(`Qty ${i.quantity}`);
  return parts;
}

/** Equipment list: table on wide screens, stacked cards on phones. */
export function EquipmentTable({ items, showProject = true }: { items: ItemRow[]; showProject?: boolean }) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border border-border bg-surface md:block">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-2/60 text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Equipment</th>
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
                <td className="px-4 py-2.5">
                  <Link href={`/equipment/${i.id}`} className="font-medium after:absolute after:inset-0">
                    {i.typeName}
                  </Link>
                  <div className="text-xs text-muted">
                    <Mono>{identifiers(i).join(" · ") || "No serial"}</Mono>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-muted">{i.categoryName ?? "—"}</td>
                <td className="px-3 py-2.5">{i.rentalHouseShort ?? i.rentalHouseName ?? <span className="text-muted">Owned</span>}</td>
                {showProject && <td className="px-3 py-2.5">{i.projectName ?? <span className="text-muted">—</span>}</td>}
                <td className="px-3 py-2.5">{i.caseName ?? <span className="text-muted">—</span>}</td>
                <td className="px-3 py-2.5">
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
            <Link href={`/equipment/${i.id}`} className="block rounded-xl border border-border bg-surface px-4 py-3 active:bg-surface-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{i.typeName}</div>
                  <div className="text-xs text-muted">
                    <Mono>{identifiers(i).join(" · ") || "No serial"}</Mono>
                  </div>
                </div>
                <StatusBadge status={i.status} />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                <span>{i.rentalHouseShort ?? i.rentalHouseName ?? "Owned"}</span>
                {showProject && i.projectName && <span>{i.projectName}</span>}
                {i.caseName && <span>▣ {i.caseName}</span>}
                <ConditionBadge condition={i.condition} hideOk />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
