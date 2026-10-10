"use client";

import { useEffect, useState } from "react";
import { ActionForm, Field, Select, SubmitButton } from "@/components/forms";
import { useT } from "@/components/i18n";
import { CONDITION_LABEL, STATUS_LABEL } from "@/lib/format";
import { assignAction, removeFromProjectAction, updateItemStateAction } from "./actions";

const ON_PROJECT = ["on_project", "in_use", "ready_for_return", "missing"];

function Choice({ label, id, name, value, onChange, options }: { label: string; id: string; name: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select id={id} name={name} value={value} onChange={(e) => onChange(e.target.value)} className="input">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Status, condition and case in one form with one save; for bulk items "apply to N of M" appears once something changed. */
export function ItemActions({
  itemId,
  version,
  status,
  condition,
  projectId,
  projects,
  quantity = 1,
  caseId = null,
  cases = [],
}: {
  itemId: string;
  version: number;
  status: string;
  condition: string;
  projectId: string | null;
  projects: { value: string; label: string }[];
  /** Units of a bulk item; above 1 a change can apply to only some of them. */
  quantity?: number;
  caseId?: string | null;
  /** Cases of the item's project. */
  cases?: { value: string; label: string }[];
}) {
  const t = useT();
  const [s, setS] = useState(status);
  const [c, setC] = useState(condition);
  const [k, setK] = useState(caseId ?? "");
  const [showRemove, setShowRemove] = useState(false);
  // Follow the item when it changes elsewhere (save, undo, another device).
  useEffect(() => {
    setS(status);
    setC(condition);
    setK(caseId ?? "");
  }, [status, condition, caseId]);
  const dirty = s !== status || c !== condition || k !== (caseId ?? "");
  const reset = () => {
    setS(status);
    setC(condition);
    setK(caseId ?? "");
  };

  return (
    <div className="space-y-5">
      <ActionForm action={updateItemStateAction.bind(null, itemId)} className="space-y-3">
        <input type="hidden" name="expectedVersion" value={version} />
        <div className="grid grid-cols-2 gap-3">
          {projectId && (
            <Choice label={t("Status")} id="state-status" name="status" value={s} onChange={setS} options={ON_PROJECT.map((v) => ({ value: v, label: t(STATUS_LABEL[v]!) }))} />
          )}
          <div className={projectId ? "" : "col-span-2"}>
            <Choice label={t("Condition")} id="state-condition" name="condition" value={c} onChange={setC} options={Object.entries(CONDITION_LABEL).map(([value, label]) => ({ value, label: t(label) }))} />
          </div>
        </div>
        {projectId && cases.length > 0 && (
          <Choice label={t("Set")} id="state-case" name="caseId" value={k} onChange={setK} options={[{ value: "", label: t("Not in a set") }, ...cases]} />
        )}
        {dirty && (
          <div className="space-y-3 rounded-lg bg-surface-2/60 p-3">
            {quantity > 1 && (
              <label className="flex items-center gap-2 text-sm">
                {t("Apply to")}
                <input
                  type="number"
                  name="units"
                  min={1}
                  max={quantity}
                  defaultValue={quantity}
                  inputMode="numeric"
                  aria-label={t("Units (of {n})", { n: quantity })}
                  className="w-16 rounded-md border border-border bg-surface px-1.5 py-1 text-right tabular-nums"
                />
                {t("of {n} units", { n: quantity })}
              </label>
            )}
            <Field name="note" id="state-note" placeholder={c !== condition ? t("What happened? (optional)") : t("Note (optional)")} aria-label={t("Note")} />
            <div className="flex items-center gap-3">
              <SubmitButton>{t("Save changes")}</SubmitButton>
              <button type="button" onClick={reset} className="text-sm text-muted hover:text-text">
                {t("Cancel")}
              </button>
            </div>
          </div>
        )}
      </ActionForm>

      {!projectId && (
        <ActionForm action={assignAction.bind(null, itemId)} className="space-y-2 border-t border-border pt-4">
          <Select label={t("Add to project")} name="projectId" placeholder={t("Choose project…")} options={projects} required />
          <SubmitButton variant="secondary" disabled={projects.length === 0}>
            {t("Add to project")}
          </SubmitButton>
        </ActionForm>
      )}

      {projectId && (
        <div className="border-t border-border pt-4">
          {showRemove ? (
            <ActionForm action={removeFromProjectAction.bind(null, itemId, projectId)} className="space-y-2">
              <Field
                label={t("Remove from project")}
                name="reason"
                placeholder={t("Reason, e.g. added by mistake")}
                hint={t("For mistakes only. Returns to a rental house go through return notes.")}
                required
              />
              <div className="flex gap-2">
                <SubmitButton variant="danger">{t("Remove")}</SubmitButton>
                <button type="button" className="text-sm text-muted hover:text-text" onClick={() => setShowRemove(false)}>
                  {t("Cancel")}
                </button>
              </div>
            </ActionForm>
          ) : (
            <button type="button" onClick={() => setShowRemove(true)} className="text-sm text-muted hover:text-danger">
              {t("Remove from project…")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
