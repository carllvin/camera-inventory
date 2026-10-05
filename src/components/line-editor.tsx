"use client";

import { Trash2 } from "lucide-react";
import { ActionForm, Field, SubmitButton } from "./forms";
import type { ActionState } from "@/server/actions";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export interface EditableLine {
  id: string;
  label: string;
  quantity: number;
  typeName: string | null;
  categoryName: string | null;
  updateAction: Action;
  removeAction: Action;
}

/** Edit expected lines (cases and templates share this). */
export function LineEditor({ lines }: { lines: EditableLine[] }) {
  if (lines.length === 0) return <p className="text-sm text-muted">Nothing expected yet.</p>;
  return (
    <ul className="divide-y divide-border">
      {lines.map((l) => (
        <li key={l.id} className="flex items-start gap-2 py-2">
          <ActionForm action={l.updateAction} className="flex flex-1 items-start gap-2">
            <Field name="quantity" id={`qty-${l.id}`} type="number" min={1} max={999} defaultValue={l.quantity} aria-label={`Quantity of ${l.label}`} className="w-16" />
            <div className="min-w-0 flex-1">
              <Field name="label" id={`label-${l.id}`} defaultValue={l.label} aria-label="Label" />
              <p className="mt-0.5 truncate text-[11px] text-muted">{l.typeName ? `Type: ${l.typeName}` : `Category: ${l.categoryName} (incl. subcategories)`}</p>
            </div>
            <SubmitButton variant="secondary" className="mt-0.5 !px-2.5 text-xs">
              Save
            </SubmitButton>
          </ActionForm>
          <ActionForm action={l.removeAction}>
            <SubmitButton variant="ghost" className="mt-0.5 !px-2 text-muted hover:text-danger" pendingText="…" aria-label={`Remove ${l.label}`}>
              <Trash2 className="size-4" />
            </SubmitButton>
          </ActionForm>
        </li>
      ))}
    </ul>
  );
}

/** Add a line: pick an exact equipment type or "any item of a category". */
export function AddLineForm({ action, types, categories }: { action: Action; types: { value: string; label: string }[]; categories: { value: string; label: string }[] }) {
  return (
    <ActionForm action={action} className="grid gap-2 sm:grid-cols-[5rem_1fr_1fr_auto] sm:items-start" resetOnSuccess>
      <Field name="quantity" id="add-qty" type="number" min={1} max={999} defaultValue={1} aria-label="Quantity" />
      <div>
        <select name="target" id="add-target" aria-label="Equipment type or category" className="input" defaultValue="">
          <option value="" disabled>
            Equipment type or category…
          </option>
          <optgroup label="Equipment types">
            {types.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Any item of a category">
            {categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </optgroup>
        </select>
      </div>
      <Field name="label" id="add-label" placeholder="Label (optional)" aria-label="Label" />
      <SubmitButton>Add</SubmitButton>
    </ActionForm>
  );
}
