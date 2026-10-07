"use client";

import { useRef } from "react";
import { Minus, Plus, Trash2, X } from "lucide-react";
import { ActionForm, Field, SubmitButton } from "./forms";
import { TypePicker } from "./type-picker";
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
export function AddLineForm({ action, categories }: { action: Action; categories: { value: string; label: string }[] }) {
  return (
    <ActionForm action={action} className="grid gap-2 sm:grid-cols-[5rem_1fr_1fr_auto] sm:items-start" resetOnSuccess>
      <Field name="quantity" id="add-qty" type="number" min={1} max={999} defaultValue={1} aria-label="Quantity" />
      <TypePicker name="target" id="add-target" valuePrefix="type:" placeholder="Equipment type or category…" extraOptions={categories} extraLabel="any item of category" aria-label="Equipment type or category" />
      <Field name="label" id="add-label" placeholder="Label (optional)" aria-label="Label" />
      <SubmitButton>Add</SubmitButton>
    </ActionForm>
  );
}

export interface QuickLine {
  id: string;
  label: string;
  quantity: number;
  hint: string;
  /** Bound actions: one unit less / more, remove the line. */
  less: Action;
  more: Action;
  remove: Action;
}

function IconAction({ action, label, children, className }: { action: Action; label: string; children: React.ReactNode; className?: string }) {
  return (
    <ActionForm action={action}>
      <SubmitButton variant="ghost" aria-label={label} pendingText="…" className={className ?? "!p-1.5"}>
        {children}
      </SubmitButton>
    </ActionForm>
  );
}

/**
 * Expected contents without forms to fill in: − / + / × act immediately, choosing
 * a type or category in the search adds it right away, and "Use what's packed now"
 * turns the current contents into the expected contents.
 */
export function QuickExpectedEditor({
  lines,
  addAction,
  categories,
  useContents,
}: {
  lines: QuickLine[];
  addAction: Action;
  categories: { value: string; label: string }[];
  useContents?: { action: Action; pieces: number };
}) {
  const form = useRef<HTMLDivElement>(null);
  const submitPick = () =>
    setTimeout(() => {
      const root = form.current;
      const value = root?.querySelector<HTMLInputElement>('input[type="hidden"][name="target"]')?.value;
      if (value) root?.closest("form")?.requestSubmit();
    }, 0);
  return (
    <div className="space-y-4">
      {useContents && useContents.pieces > 0 && (
        <ActionForm action={useContents.action} className="flex flex-col items-start gap-2 rounded-lg bg-accent-soft/50 p-3 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 text-sm">Packed it already? Make the {useContents.pieces} pieces in it the expected contents.</p>
          <SubmitButton variant="secondary" pendingText="…">
            Use what&apos;s packed now
          </SubmitButton>
        </ActionForm>
      )}
      {lines.length === 0 ? (
        <p className="text-sm text-muted">Nothing expected yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {lines.map((l) => (
            <li key={l.id} className="flex items-center gap-2 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{l.label}</div>
                <div className="truncate text-[11px] text-muted">{l.hint}</div>
              </div>
              <div className="flex items-center rounded-lg border border-border">
                <IconAction action={l.less} label={`One ${l.label} less`}>
                  <Minus className="size-3.5" />
                </IconAction>
                <span className="w-7 text-center text-sm font-medium tabular-nums" aria-label={`${l.label}: ${l.quantity}`}>
                  {l.quantity}
                </span>
                <IconAction action={l.more} label={`One ${l.label} more`}>
                  <Plus className="size-3.5" />
                </IconAction>
              </div>
              <IconAction action={l.remove} label={`Remove ${l.label}`} className="!p-1.5 text-muted hover:text-danger">
                <X className="size-4" />
              </IconAction>
            </li>
          ))}
        </ul>
      )}
      <ActionForm action={addAction} resetOnSuccess>
        <div ref={form}>
          <input type="hidden" name="quantity" value="1" />
          <TypePicker
            name="target"
            id="quick-add"
            valuePrefix="type:"
            label="Add to the expected contents"
            placeholder="Search a type, or a category for “any …”"
            extraOptions={categories}
            extraLabel="any item of category"
            onChange={submitPick}
          />
        </div>
      </ActionForm>
    </div>
  );
}
