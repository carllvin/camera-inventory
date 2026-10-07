"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Mono } from "@/components/ui";
import { cn } from "@/lib/format";
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
};

/**
 * The project's equipment that is not in this case, as one list to tick off.
 * Units without a serial number take a count; ticking something that sits in
 * another case moves it here (the row says so).
 */
export function PackChecklist({ rows, action }: { rows: ChecklistRow[]; action: (prev: ActionState, fd: FormData) => Promise<ActionState> }) {
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
      {needed.length > 0 && (
        <button type="button" onClick={() => setTicked(new Set([...ticked, ...needed.map((r) => r.key)]))} className="mb-2 text-xs text-accent hover:underline">
          Tick everything this case still needs ({needed.length})
        </button>
      )}
      <ul className="-mx-1 max-h-[32rem] divide-y divide-border overflow-y-auto">
        {rows.map((r) => {
          const on = ticked.has(r.key);
          return (
            <li key={r.key} className={cn("flex items-center gap-2 px-1 py-1.5", on && "bg-accent-soft/50")}>
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                <input type="checkbox" name="row" value={r.key} checked={on} onChange={(e) => toggle(r.key, e.target.checked)} className="size-4 shrink-0" />
                <input type="hidden" name={`ids_${r.key}`} value={r.itemIds.join(",")} disabled={!on} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm">{r.typeName}</span>
                    {r.needed > 0 && <Badge tone="warn">needed</Badge>}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    <Mono>{r.serialNumber ? `SN ${r.serialNumber}` : r.assetNumber ? `Asset ${r.assetNumber}` : r.units > 1 ? `${r.units} pcs · no serial` : "No serial"}</Mono>
                    {r.status === "missing" && <span className="text-danger"> · missing</span>}
                    {r.condition !== "ok" && r.condition !== "unknown" && <span className="text-warn"> · {r.condition.replaceAll("_", " ")}</span>}
                    {r.caseName && <span className="text-warn"> · in {r.caseName}{on && " — will be moved"}</span>}
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
                    aria-label={`How many ${r.typeName} (of ${r.units})`}
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
        <SubmitButton className="w-full" disabled={total === 0} pendingText="Packing…">
          {total === 0 ? "Tick what goes into this set" : `Add ${total} to this set`}
        </SubmitButton>
        {moving > 0 && <p className="mt-1 text-center text-xs text-warn">{moving} ticked {moving === 1 ? "entry is" : "entries are"} moved from another case.</p>}
      </div>
    </ActionForm>
  );
}
