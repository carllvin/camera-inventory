"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ActionForm, Field, Select, SubmitButton } from "@/components/forms";
import { Badge, Mono } from "@/components/ui";
import { cn } from "@/lib/format";
import type { ActionState } from "@/server/actions";
import { RESOLUTION } from "./resolution";

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
  updateAction: Action;
  removeAction: Action;
}

/** One reviewable line: collapsed summary, tap to edit. */
export function LineCard({ line, types }: { line: ReviewLine; types: { value: string; label: string }[] }) {
  const needsAttention = line.resolution === "pending" || line.resolution === "discrepancy";
  const [open, setOpen] = useState(needsAttention);
  const r = RESOLUTION[line.resolution] ?? RESOLUTION.pending!;
  const typeLabel = types.find((t) => t.value === line.matchedEquipmentTypeId)?.label;
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
            <Select
              label="Equipment type"
              name="equipmentTypeId"
              id={`t-${line.id}`}
              placeholder="Detect automatically"
              defaultValue={line.matchedEquipmentTypeId}
              options={types}
              className="sm:col-span-6"
              hint={
                <>
                  Not in the list? <Link href="/equipment/types/new" target="_blank" className="text-accent hover:underline">Create the type</Link>, then reload.
                </>
              }
            />
            <label className="flex items-center gap-2 text-sm sm:col-span-6">
              <input type="checkbox" name="ignore" value="1" defaultChecked={line.resolution === "ignore"} className="size-4 accent-[var(--accent)]" />
              Ignore this line (not equipment, or not actually delivered)
            </label>
            <div className="flex items-center justify-between sm:col-span-6">
              <SubmitButton variant="secondary">Save line</SubmitButton>
            </div>
          </ActionForm>
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

export function AddLineCard({ action, types }: { action: Action; types: { value: string; label: string }[] }) {
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
        <Select label="Equipment type" name="equipmentTypeId" id="new-type" placeholder="Detect automatically" options={types} className="sm:col-span-6" />
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

export function ConfirmButton({ action, disabled, count }: { action: Action; disabled: boolean; count: number }) {
  return (
    <ActionForm action={action}>
      <SubmitButton disabled={disabled} className="w-full py-3 text-base" pendingText="Confirming…">
        Confirm delivery ({count} item{count === 1 ? "" : "s"})
      </SubmitButton>
    </ActionForm>
  );
}
