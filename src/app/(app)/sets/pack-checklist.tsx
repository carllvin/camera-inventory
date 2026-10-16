"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { useT } from "@/components/i18n";
import { Badge, Mono } from "@/components/ui";
import { cn } from "@/lib/format";
import { Thumb } from "@/components/thumb";
import type { ActionState } from "@/server/actions";

export type ChecklistRow = {
  key: string;
  itemIds: string[];
  typeName: string;
  serialNumber: string | null;
  assetNumber: string | null;
  units: number;
  caseName: string | null;
  status: string;
  condition: string;
  needed: number;
  imageId: string | null;
};

/**
 * The project's equipment that is not in this case, as one list to tick off.
 * Units without a serial number take a count; ticking something that sits in
 * another case moves it here (the row says so).
 */
export function PackChecklist({ rows, action }: { rows: ChecklistRow[]; action: (prev: ActionState, fd: FormData) => Promise<ActionState> }) {
  const t = useT();
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [counts, setCounts] = useState<Record<string, number>>({});
  const toggle = (key: string, on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  // Without serials: 1 by default, or as many as the set still expects.
  const count = (r: ChecklistRow) => (r.units > 1 ? (counts[r.key] ?? (r.needed ? Math.min(r.needed, r.units) : 1)) : 1);
  const total = rows.filter((r) => ticked.has(r.key)).reduce((n, r) => n + count(r), 0);
  const needed = rows.filter((r) => r.needed > 0);
  const moving = rows.filter((r) => ticked.has(r.key) && r.caseName).length;

  return (
    <ActionForm
      action={action}
      onSuccess={() => {
        setTicked(new Set());
        setCounts({});
      }}
    >
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
        {needed.length > 0 && (
          <button type="button" onClick={() => setTicked(new Set([...ticked, ...needed.map((r) => r.key)]))} className="text-xs text-accent hover:underline">
            {t("Tick everything this case still needs ({n})", { n: needed.length })}
          </button>
        )}
        {rows.length > 1 && (
          <button type="button" onClick={() => setTicked(ticked.size === rows.length ? new Set() : new Set(rows.map((r) => r.key)))} className="text-xs text-accent hover:underline">
            {ticked.size === rows.length ? t("Select none") : t("Select all ({n})", { n: rows.length })}
          </button>
        )}
      </div>
      <ul className="-mx-1 max-h-[32rem] divide-y divide-border overflow-y-auto">
        {rows.map((r) => {
          const on = ticked.has(r.key);
          return (
            <li key={r.key} className={cn("flex items-center gap-2 px-1 py-1.5", on && "bg-accent-soft/50")}>
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                <input type="checkbox" name="row" value={r.key} checked={on} onChange={(e) => toggle(r.key, e.target.checked)} className="size-4 shrink-0" />
                <input type="hidden" name={`ids_${r.key}`} value={r.itemIds.join(",")} disabled={!on} />
                <Thumb photoId={r.imageId} name={r.typeName} className="size-8" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm">{r.typeName}</span>
                    {r.needed > 0 && <Badge tone="warn">{t("needed")}</Badge>}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    <Mono>{r.serialNumber ? `SN ${r.serialNumber}` : r.assetNumber ? t("Asset {n}", { n: r.assetNumber }) : r.units > 1 ? t("{n} pcs · no serial", { n: r.units }) : t("No serial")}</Mono>
                    {r.status === "missing" && <span className="text-danger"> · {t("missing")}</span>}
                    {r.condition !== "ok" && r.condition !== "unknown" && <span className="text-warn"> · {r.condition === "minor_wear" ? t("minor wear") : r.condition === "damaged" ? t("damaged") : r.condition === "defective" ? t("defective") : r.condition.replaceAll("_", " ")}</span>}
                    {r.caseName && <span className="text-warn"> · {on ? t("in {set} — will be moved", { set: r.caseName }) : t("in {set}", { set: r.caseName })}</span>}
                  </span>
                </span>
              </label>
              {r.units > 1 && (
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
                  <input
                    type="number"
                    name={`units_${r.key}`}
                    min={1}
                    max={r.units}
                    value={count(r)}
                    disabled={!on}
                    onChange={(e) => setCounts({ ...counts, [r.key]: Math.max(1, Math.min(r.units, Number(e.target.value) || 1)) })}
                    inputMode="numeric"
                    aria-label={t("How many {type} (of {n})", { type: r.typeName, n: r.units })}
                    className="w-12 rounded-md border border-border bg-surface px-1 py-0.5 text-right tabular-nums disabled:opacity-40"
                  />
                  /{r.units}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="sticky bottom-0 -mx-4 mt-2 border-t border-border bg-surface px-4 pt-3 pb-1">
        <SubmitButton className="w-full" disabled={total === 0} pendingText={t("Packing…")}>
          {total === 0 ? t("Tick what goes into this set") : t("Add {n} to this set", { n: total })}
        </SubmitButton>
        {moving > 0 && <p className="mt-1 text-center text-xs text-warn">{moving === 1 ? t("1 ticked entry is moved from another case.") : t("{n} ticked entries are moved from another case.", { n: moving })}</p>}
      </div>
    </ActionForm>
  );
}
