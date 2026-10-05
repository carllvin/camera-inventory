"use client";

import { useState } from "react";
import { ActionForm, Field, Select, SubmitButton } from "@/components/forms";
import { CONDITION_LABEL, STATUS_LABEL } from "@/lib/format";
import { assignAction, changeConditionAction, changeStatusAction, removeFromProjectAction } from "./actions";

const ON_PROJECT = ["on_project", "in_use", "ready_for_return", "missing"];

export function ItemActions({
  itemId,
  version,
  status,
  condition,
  projectId,
  projects,
}: {
  itemId: string;
  version: number;
  status: string;
  condition: string;
  projectId: string | null;
  projects: { value: string; label: string }[];
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

      <ActionForm action={changeConditionAction.bind(null, itemId)} className="space-y-2">
        <input type="hidden" name="expectedVersion" value={version} />
        <Select
          label="Condition"
          name="condition"
          defaultValue={condition}
          options={Object.entries(CONDITION_LABEL).map(([value, label]) => ({ value, label }))}
        />
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
