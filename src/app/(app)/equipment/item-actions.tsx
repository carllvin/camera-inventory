"use client";

import { useState } from "react";
import { ActionForm, Field, Select, SubmitButton } from "@/components/forms";
import { CONDITION_LABEL, STATUS_LABEL } from "@/lib/format";
import { assignAction, changeConditionAction, changeStatusAction, removeFromProjectAction, setCaseAction } from "./actions";

const ON_PROJECT = ["on_project", "in_use", "ready_for_return", "missing"];

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
  /** Units of a bulk item; above 1 every change asks whether it applies to all or only some. */
  quantity?: number;
  caseId?: string | null;
  /** Cases of the item's project. */
  cases?: { value: string; label: string }[];
}) {
  const [showRemove, setShowRemove] = useState(false);
  return (
    <div className="space-y-5">
      {projectId ? (
        <ActionForm action={changeStatusAction.bind(null, itemId)} className="space-y-2">
          <input type="hidden" name="expectedVersion" value={version} />
          <Select
            label="Status"
            name="status"
            defaultValue={status}
            options={ON_PROJECT.map((s) => ({ value: s, label: STATUS_LABEL[s]! }))}
            hint="Missing is only ever set by a person — never automatically."
          />
          {quantity > 1 && <UnitsChoice id="status" quantity={quantity} />}
          <Field name="note" id="status-note" placeholder="Note (optional)" aria-label="Status note" />
          <SubmitButton variant="secondary">Update status</SubmitButton>
        </ActionForm>
      ) : (
        <ActionForm action={assignAction.bind(null, itemId)} className="space-y-2">
          <Select label="Add to project" name="projectId" placeholder="Choose project…" options={projects} required />
          <SubmitButton variant="secondary" disabled={projects.length === 0}>
            Add to project
          </SubmitButton>
        </ActionForm>
      )}

      {projectId && cases.length > 0 && (
        <ActionForm action={setCaseAction.bind(null, itemId)} className="space-y-2">
          <Select label="Case" name="caseId" defaultValue={caseId ?? ""} options={[{ value: "", label: "Not in a case" }, ...cases]} />
          {quantity > 1 && <UnitsChoice id="case" quantity={quantity} />}
          <SubmitButton variant="secondary">Save case</SubmitButton>
        </ActionForm>
      )}

      <ActionForm action={changeConditionAction.bind(null, itemId)} className="space-y-2">
        <input type="hidden" name="expectedVersion" value={version} />
        <Select
          label="Condition"
          name="condition"
          defaultValue={condition}
          options={Object.entries(CONDITION_LABEL).map(([value, label]) => ({ value, label }))}
        />
        {quantity > 1 && <UnitsChoice id="condition" quantity={quantity} />}
        <Field name="note" id="condition-note" placeholder="What happened? (optional)" aria-label="Condition note" />
        <SubmitButton variant="secondary">Update condition</SubmitButton>
      </ActionForm>

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

/** "All 10" or "Only [ 2 ]": a change to some units splits them off as their own item. */
function UnitsChoice({ id, quantity }: { id: string; quantity: number }) {
  const [some, setSome] = useState(false);
  return (
    <fieldset className="space-y-1.5 text-sm">
      <legend className="sr-only">Applies to</legend>
      <label className="flex items-center gap-2">
        <input type="radio" name={`${id}-scope`} checked={!some} onChange={() => setSome(false)} />
        All {quantity} units
      </label>
      <label className="flex items-center gap-2">
        <input type="radio" name={`${id}-scope`} checked={some} onChange={() => setSome(true)} />
        Only some:
        <input
          type="number"
          name={some ? "units" : undefined}
          min={1}
          max={quantity - 1}
          defaultValue={1}
          disabled={!some}
          inputMode="numeric"
          aria-label={`How many units (${id})`}
          className="w-16 rounded-md border border-border bg-surface px-1.5 py-0.5 text-right tabular-nums disabled:opacity-50"
        />
      </label>
      {some && <p className="text-xs text-muted">These units become their own entry; the rest stays unchanged.</p>}
    </fieldset>
  );
}
