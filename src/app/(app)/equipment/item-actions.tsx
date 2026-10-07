"use client";

import { useState } from "react";
import { ActionForm, Field, Select, SubmitButton } from "@/components/forms";
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
  const [s, setS] = useState(status);
  const [c, setC] = useState(condition);
  const [k, setK] = useState(caseId ?? "");
  const [showRemove, setShowRemove] = useState(false);
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
            <Choice label="Status" id="state-status" name="status" value={s} onChange={setS} options={ON_PROJECT.map((v) => ({ value: v, label: STATUS_LABEL[v]! }))} />
          )}
          <div className={projectId ? "" : "col-span-2"}>
            <Choice label="Condition" id="state-condition" name="condition" value={c} onChange={setC} options={Object.entries(CONDITION_LABEL).map(([value, label]) => ({ value, label }))} />
          </div>
        </div>
        {projectId && cases.length > 0 && (
          <Choice label="Set" id="state-case" name="caseId" value={k} onChange={setK} options={[{ value: "", label: "Not in a set" }, ...cases]} />
        )}
        {dirty && (
          <div className="space-y-3 rounded-lg bg-surface-2/60 p-3">
            {quantity > 1 && (
              <label className="flex items-center gap-2 text-sm">
                Apply to
                <input
                  type="number"
                  name="units"
                  min={1}
                  max={quantity}
                  defaultValue={quantity}
                  inputMode="numeric"
                  aria-label={`Units (of ${quantity})`}
                  className="w-16 rounded-md border border-border bg-surface px-1.5 py-1 text-right tabular-nums"
                />
                of {quantity} units
              </label>
            )}
            <Field name="note" id="state-note" placeholder={c !== condition ? "What happened? (optional)" : "Note (optional)"} aria-label="Note" />
            <div className="flex items-center gap-3">
              <SubmitButton>Save changes</SubmitButton>
              <button type="button" onClick={reset} className="text-sm text-muted hover:text-text">
                Cancel
              </button>
            </div>
          </div>
        )}
      </ActionForm>

      {!projectId && (
        <ActionForm action={assignAction.bind(null, itemId)} className="space-y-2 border-t border-border pt-4">
          <Select label="Add to project" name="projectId" placeholder="Choose project…" options={projects} required />
          <SubmitButton variant="secondary" disabled={projects.length === 0}>
            Add to project
          </SubmitButton>
        </ActionForm>
      )}

      {projectId && (
        <div className="border-t border-border pt-4">
          {showRemove ? (
            <ActionForm action={removeFromProjectAction.bind(null, itemId, projectId)} className="space-y-2">
              <Field
                label="Remove from project"
                name="reason"
                placeholder="Reason, e.g. added by mistake"
                hint="For mistakes only. Returns to a rental house go through return notes."
                required
              />
              <div className="flex gap-2">
                <SubmitButton variant="danger">Remove</SubmitButton>
                <button type="button" className="text-sm text-muted hover:text-text" onClick={() => setShowRemove(false)}>
                  Cancel
                </button>
              </div>
            </ActionForm>
          ) : (
            <button type="button" onClick={() => setShowRemove(true)} className="text-sm text-muted hover:text-danger">
              Remove from project…
            </button>
          )}
        </div>
      )}
    </div>
  );
}
