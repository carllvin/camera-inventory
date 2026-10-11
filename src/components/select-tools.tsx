"use client";

import { useEffect, useRef, useState } from "react";
import { SubmitButton } from "./forms";
import { useT } from "./i18n";
import { CONDITION_LABEL, STATUS_LABEL } from "@/lib/format";

/**
 * Tick on a type line: ticks every entry of that type (without opening the line).
 * Handled by SelectionBar's native listener, so it keeps working after the form reset.
 */
export function TypeTick({ typeId, label }: { typeId: string; label: string }) {
  const t = useT();
  return (
    <input
      type="checkbox"
      aria-label={t("Select all {label}", { label })}
      className="size-4 shrink-0"
      data-select-type={typeId}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/** Tick on one entry; entries without serials get a count. */
export function EntryTick({ entryKey, itemIds, units, typeId, label }: { entryKey: string; itemIds: string[]; units: number; typeId: string; label: string }) {
  const t = useT();
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <input type="checkbox" name="row" value={entryKey} data-type={typeId} aria-label={t("Select {label}", { label })} className="size-4" />
      <input type="hidden" name={`ids_${entryKey}`} value={itemIds.join(",")} />
      {units > 1 && (
        <input
          type="number"
          name={`units_${entryKey}`}
          min={1}
          max={units}
          defaultValue={units}
          inputMode="numeric"
          aria-label={t("How many {label} (of {units})", { label, units })}
          className="w-12 rounded-md border border-border bg-surface px-1 py-0.5 text-right text-xs tabular-nums"
        />
      )}
    </span>
  );
}

const STATUS = ["on_project", "in_use", "ready_for_return", "missing"] as const;
const CONDITION = ["ok", "minor_wear", "damaged", "defective"] as const;

/** Sticky bar: what to do with the ticked entries. */
export function SelectionBar({ sets }: { sets: { value: string; label: string }[] }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);
  const [op, setOp] = useState("");
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const update = () => setCount(form.querySelectorAll('input[name="row"]:checked').length);
    const onChange = (e: Event) => {
      const tick = e.target as HTMLInputElement;
      const typeId = tick.dataset?.selectType;
      // Only within the tick's own list: in the set view one type can appear under several sets.
      const scope = tick.closest("[data-type-scope]") ?? form;
      if (typeId)
        scope.querySelectorAll<HTMLInputElement>(`input[data-type="${CSS.escape(typeId)}"]`).forEach((c) => {
          c.checked = tick.checked;
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
      <span className="px-1 text-sm font-medium tabular-nums">{t("{n} selected", { n: count })}</span>
      <select name="op" value={op} onChange={(e) => setOp(e.target.value)} aria-label={t("Action")} className="input !w-auto min-w-0 flex-1 !py-1.5 text-sm">
        <option value="">{t("Choose an action…")}</option>
        {sets.length > 0 && (
          <optgroup label={t("Add to set")}>
            {sets.map((s) => (
              <option key={s.value} value={`set:${s.value}`}>
                ▣ {s.label}
              </option>
            ))}
          </optgroup>
        )}
        <option value="unpack">{t("Take out of their set")}</option>
        <optgroup label={t("Status")}>
          {STATUS.map((v) => (
            <option key={v} value={`status:${v}`}>
              {t(STATUS_LABEL[v]!)}
            </option>
          ))}
        </optgroup>
        <optgroup label={t("Condition")}>
          {CONDITION.map((v) => (
            <option key={v} value={`condition:${v}`}>
              {t(CONDITION_LABEL[v]!)}
            </option>
          ))}
        </optgroup>
        <option value="remove">{t("Remove from project…")}</option>
      </select>
      <SubmitButton disabled={count === 0 || !op} className="!py-1.5" pendingText="…">
        {t("Apply")}
      </SubmitButton>
    </div>
  );
}

/** Sticky bar for deleting the ticked equipment types (types list, select mode). */
export function DeleteTypesBar() {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const update = () => setCount(form.querySelectorAll('input[name="typeId"]:checked').length);
    const onReset = () => setTimeout(update, 0);
    form.addEventListener("change", update);
    form.addEventListener("reset", onReset);
    update();
    return () => {
      form.removeEventListener("change", update);
      form.removeEventListener("reset", onReset);
    };
  }, []);
  return (
    <div ref={ref} className="sticky bottom-20 z-10 mt-3 flex items-center justify-between gap-2 rounded-xl border border-border bg-surface p-2 shadow-lg md:bottom-4">
      <span className="px-1 text-sm font-medium tabular-nums">{t("{n} selected", { n: count })}</span>
      <SubmitButton variant="danger" disabled={count === 0} className="!py-1.5" pendingText={t("Deleting…")}>
        {count === 1 ? t("Delete type") : t("Delete types")}
      </SubmitButton>
    </div>
  );
}
