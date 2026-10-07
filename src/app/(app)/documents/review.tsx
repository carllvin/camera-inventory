"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ActionForm, Field, Select, SubmitButton } from "@/components/forms";
import { TypePicker } from "@/components/type-picker";
import { Badge, Mono } from "@/components/ui";
import { cn } from "@/lib/format";
import type { ActionState } from "@/server/actions";
import { RESOLUTION, RETURN_RESOLUTION } from "./resolution";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** Refresh the page while the AI is reading the document. */
export function AutoRefresh({ intervalMs = 3000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [router, intervalMs]);
  return null;
}

export interface ReviewLine {
  id: string;
  lineNumber: number;
  description: string;
  rawText: string | null;
  quantity: number;
  serialNumber: string | null;
  assetNumber: string | null;
  aiConfidence: number | null;
  resolution: string;
  matchReason: string | null;
  matchedEquipmentTypeId: string | null;
  matchedEquipmentItemId: string | null;
  typeName: string | null;
  updateAction: Action;
  removeAction: Action;
  reportAction?: Action;
  /** Product not known yet: create its type in one click (fields pre-filled, by the AI when it read the note). */
  newType?: NewTypeDraft;
}

type Option = { value: string; label: string };

export interface NewTypeDraft {
  action: Action;
  manufacturer: string;
  model: string;
  categoryId: string | null;
  tracking: "serialized" | "bulk";
  categories: Option[];
  byAi: boolean;
}

/** Pre-filled "create this product" strip: one click on Create & use, or adjust the fields first. */
function NewTypeStrip({ draft, lineId }: { draft: NewTypeDraft; lineId: string }) {
  return (
    <ActionForm action={draft.action} className="grid gap-2 border-t border-dashed border-warn/40 bg-warn/5 px-4 py-3 sm:grid-cols-12">
      <p className="text-xs font-medium text-warn sm:col-span-12">New product{draft.byAi && " — fields suggested by AI"}. Check and create it:</p>
      <Field name="manufacturer" id={`nm-${lineId}`} aria-label="Manufacturer" placeholder="Manufacturer" defaultValue={draft.manufacturer} className="sm:col-span-3" />
      <Field name="model" id={`nmo-${lineId}`} aria-label="Model" placeholder="Model" defaultValue={draft.model} className="sm:col-span-4" />
      <Select name="categoryId" id={`nc-${lineId}`} aria-label="Category" placeholder="No category" defaultValue={draft.categoryId} options={draft.categories} className="sm:col-span-3" />
      <Select
        name="tracking"
        id={`nt-${lineId}`}
        aria-label="Tracking"
        defaultValue={draft.tracking}
        options={[
          { value: "serialized", label: "With serials" },
          { value: "bulk", label: "Quantity only" },
        ]}
        className="sm:col-span-2"
      />
      <div className="sm:col-span-12">
        <SubmitButton pendingText="Creating…">Create &amp; use</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** One reviewable line: collapsed summary, tap to edit. */
export function LineCard({ line, items, mode = "delivery" }: { line: ReviewLine; items?: Option[]; mode?: "delivery" | "return" }) {
  const needsAttention = line.resolution === "pending" || line.resolution === "discrepancy";
  const [open, setOpen] = useState(needsAttention);
  const labels = mode === "return" ? RETURN_RESOLUTION : RESOLUTION;
  const r = labels[line.resolution] ?? labels.pending!;
  const typeLabel = mode === "return" && line.matchedEquipmentItemId
    ? items?.find((i) => i.value === line.matchedEquipmentItemId)?.label
    : line.typeName;
  return (
    <li className={cn("rounded-xl border bg-surface", needsAttention ? "border-warn/50" : "border-border", line.resolution === "ignore" && "opacity-70")}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-3 px-4 py-3 text-left" aria-expanded={open}>
        <span className="mt-0.5 w-6 shrink-0 text-xs text-muted tabular-nums">{line.lineNumber}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{line.quantity > 1 && `${line.quantity} × `}{line.description}</span>
            <Badge tone={r.tone}>{r.label}</Badge>
            {line.aiConfidence !== null && line.aiConfidence < 0.7 && <Badge tone="warn">unclear text</Badge>}
          </span>
          <span className="mt-0.5 block text-xs text-muted">
            {[line.serialNumber && `SN ${line.serialNumber}`, line.assetNumber && `Asset ${line.assetNumber}`, typeLabel && `→ ${typeLabel}`].filter(Boolean).join(" · ")}
          </span>
          {line.matchReason && <span className={cn("mt-0.5 block text-xs", needsAttention ? "text-warn" : "text-muted")}>{line.matchReason}</span>}
        </span>
        <span className="text-xs text-muted">{open ? "Close" : "Edit"}</span>
      </button>
      {line.newType && line.resolution === "pending" && !line.matchedEquipmentTypeId && <NewTypeStrip draft={line.newType} lineId={line.id} />}
      {open && (
        <div className="border-t border-border px-4 py-3">
          {line.rawText && line.rawText !== line.description && (
            <p className="mb-2 text-xs text-muted">
              On document: <Mono>{line.rawText}</Mono>
            </p>
          )}
          <ActionForm action={line.updateAction} className="grid gap-3 sm:grid-cols-6">
            <Field label="Description" name="description" id={`d-${line.id}`} defaultValue={line.description} className="sm:col-span-4" />
            <Field label="Qty" name="quantity" id={`q-${line.id}`} type="number" min={1} defaultValue={line.quantity} className="sm:col-span-2" />
            <Field label="Serial number" name="serialNumber" id={`s-${line.id}`} defaultValue={line.serialNumber} spellCheck={false} className="sm:col-span-3" />
            <Field label="Asset number" name="assetNumber" id={`a-${line.id}`} defaultValue={line.assetNumber} spellCheck={false} className="sm:col-span-3" />
            {mode === "return" ? (
              <Select
                label="Item on the project"
                name="equipmentItemId"
                id={`i-${line.id}`}
                placeholder="Detect automatically"
                defaultValue={line.matchedEquipmentItemId}
                options={items ?? []}
                className="sm:col-span-6"
                hint="Pick the exact item when several identical ones are on the project."
              />
            ) : (
              <TypePicker
                label="Equipment type"
                name="equipmentTypeId"
                id={`t-${line.id}`}
                emptyLabel="Detect automatically"
                defaultValue={line.matchedEquipmentTypeId && line.typeName ? { id: line.matchedEquipmentTypeId, name: line.typeName } : null}
                className="sm:col-span-6"
                hint={
                  <>
                    Not in the list? {line.newType ? "Use “Create & use” above." : <><Link href="/equipment/types/new" target="_blank" className="text-accent hover:underline">Create the type</Link>, then reload.</>}
                  </>
                }
              />
            )}
            <label className="flex items-center gap-2 text-sm sm:col-span-6">
              <input type="checkbox" name="ignore" value="1" defaultChecked={line.resolution === "ignore"} className="size-4 accent-[var(--accent)]" />
              {mode === "return" ? "Ignore this line (not equipment, or not actually returned)" : "Ignore this line (not equipment, or not actually delivered)"}
            </label>
            <div className="flex items-center justify-between sm:col-span-6">
              <SubmitButton variant="secondary">Save line</SubmitButton>
            </div>
          </ActionForm>
          {line.reportAction && needsAttention && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-muted">Report as issue…</summary>
              <ActionForm action={line.reportAction} className="mt-2 flex flex-wrap items-end gap-2">
                <Field name="note" id={`n-${line.id}`} placeholder="What should be checked? (optional)" aria-label="Issue note" className="min-w-0 flex-1" />
                <SubmitButton variant="secondary" pendingText="…">Report issue</SubmitButton>
              </ActionForm>
            </details>
          )}
          <ActionForm action={line.removeAction} className="mt-2 flex justify-end">
            <SubmitButton variant="ghost" className="!px-2 text-xs text-muted hover:text-danger" pendingText="…">
              <Trash2 className="size-3.5" /> Delete line
            </SubmitButton>
          </ActionForm>
        </div>
      )}
    </li>
  );
}

export function AddLineCard({ action, items, mode = "delivery" }: { action: Action; items?: Option[]; mode?: "delivery" | "return" }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="w-full rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted hover:border-ring/60 hover:text-text">
        + Add a line by hand
      </button>
    );
  }
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <ActionForm action={action} className="grid gap-3 sm:grid-cols-6" resetOnSuccess>
        <Field label="Description" name="description" id="new-description" className="sm:col-span-4" autoFocus />
        <Field label="Qty" name="quantity" id="new-quantity" type="number" min={1} defaultValue={1} className="sm:col-span-2" />
        <Field label="Serial number" name="serialNumber" id="new-serial" spellCheck={false} className="sm:col-span-3" />
        <Field label="Asset number" name="assetNumber" id="new-asset" spellCheck={false} className="sm:col-span-3" />
        {mode === "return" ? (
          <Select label="Item on the project" name="equipmentItemId" id="new-item" placeholder="Detect automatically" options={items ?? []} className="sm:col-span-6" />
        ) : (
          <TypePicker label="Equipment type" name="equipmentTypeId" id="new-type" emptyLabel="Detect automatically" className="sm:col-span-6" />
        )}
        <div className="flex gap-2 sm:col-span-6">
          <SubmitButton>Add line</SubmitButton>
          <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted hover:text-text">
            Cancel
          </button>
        </div>
      </ActionForm>
    </div>
  );
}

export function ConfirmButton({ action, disabled, count, mode = "delivery" }: { action: Action; disabled: boolean; count: number; mode?: "delivery" | "return" }) {
  return (
    <ActionForm action={action}>
      <SubmitButton disabled={disabled} className="w-full py-3 text-base" pendingText="Confirming…">
        {mode === "return" ? "Confirm return" : "Confirm delivery"} ({count} item{count === 1 ? "" : "s"})
      </SubmitButton>
    </ActionForm>
  );
}
