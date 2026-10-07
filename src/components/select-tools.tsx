"use client";

import { useEffect, useRef, useState } from "react";
import { SubmitButton } from "./forms";

/**
 * Tick on a type line: ticks every entry of that type (without opening the line).
 * Handled by SelectionBar's native listener, so it keeps working after the form reset.
 */
export function TypeTick({ typeId, label }: { typeId: string; label: string }) {
  return (
    <input
      type="checkbox"
      aria-label={`Select all ${label}`}
      className="size-4 shrink-0"
      data-select-type={typeId}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/** Tick on one entry; entries without serials get a count. */
export function EntryTick({ entryKey, itemIds, units, typeId, label }: { entryKey: string; itemIds: string[]; units: number; typeId: string; label: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <input type="checkbox" name="row" value={entryKey} data-type={typeId} aria-label={`Select ${label}`} className="size-4" />
      <input type="hidden" name={`ids_${entryKey}`} value={itemIds.join(",")} />
      {units > 1 && (
        <input
          type="number"
          name={`units_${entryKey}`}
          min={1}
          max={units}
          defaultValue={units}
          inputMode="numeric"
          aria-label={`How many ${label} (of ${units})`}
          className="w-12 rounded-md border border-border bg-surface px-1 py-0.5 text-right text-xs tabular-nums"
        />
      )}
    </span>
  );
}

const STATUS = [
  ["on_project", "On project"],
  ["in_use", "In use"],
  ["ready_for_return", "Ready for return"],
  ["missing", "Missing"],
] as const;
const CONDITION = [
  ["ok", "OK"],
  ["minor_wear", "Minor wear"],
  ["damaged", "Damaged"],
  ["defective", "Defective"],
] as const;

/** Sticky bar: what to do with the ticked entries. */
export function SelectionBar({ sets }: { sets: { value: string; label: string }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);
  const [op, setOp] = useState("");
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const update = () => setCount(form.querySelectorAll('input[name="row"]:checked').length);
    const onChange = (e: Event) => {
      const t = e.target as HTMLInputElement;
      const typeId = t.dataset?.selectType;
      if (typeId)
        form.querySelectorAll<HTMLInputElement>(`input[data-type="${CSS.escape(typeId)}"]`).forEach((c) => {
          c.checked = t.checked;
        });
      update();
    };
    // After a successful action the form is reset: nothing ticked, no action chosen.
    const onReset = () => {
      setOp("");
      setTimeout(update, 0);
    };
    form.addEventListener("change", onChange);
    form.addEventListener("reset", onReset);
    update();
    return () => {
      form.removeEventListener("change", onChange);
      form.removeEventListener("reset", onReset);
    };
  }, []);
  return (
    <div ref={ref} className="sticky bottom-20 z-10 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-2 shadow-lg md:bottom-4">
      <span className="px-1 text-sm font-medium tabular-nums">{count} selected</span>
      <select name="op" value={op} onChange={(e) => setOp(e.target.value)} aria-label="Action" className="input !w-auto min-w-0 flex-1 !py-1.5 text-sm">
        <option value="">Choose an action…</option>
        {sets.length > 0 && (
          <optgroup label="Add to set">
            {sets.map((s) => (
              <option key={s.value} value={`set:${s.value}`}>
                ▣ {s.label}
              </option>
            ))}
          </optgroup>
        )}
        <option value="unpack">Take out of their set</option>
        <optgroup label="Status">
          {STATUS.map(([v, l]) => (
            <option key={v} value={`status:${v}`}>
              {l}
            </option>
          ))}
        </optgroup>
        <optgroup label="Condition">
          {CONDITION.map(([v, l]) => (
            <option key={v} value={`condition:${v}`}>
              {l}
            </option>
          ))}
        </optgroup>
        <option value="remove">Remove from project…</option>
      </select>
      <SubmitButton disabled={count === 0 || !op} className="!py-1.5" pendingText="…">
        Apply
      </SubmitButton>
    </div>
  );
}
