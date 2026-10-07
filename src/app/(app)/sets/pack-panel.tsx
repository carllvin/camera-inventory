"use client";

import { useRef } from "react";
import { BarcodeCamera } from "@/components/barcode-camera";
import { ActionForm, Field, SubmitButton, useFormState } from "@/components/forms";
import { buttonVariants } from "@/components/ui";
import type { ActionState } from "@/server/actions";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

function MoveConfirm() {
  const state = useFormState();
  if (!state?.details?.needsMoveConfirmation) return null;
  return (
    <button type="submit" name="allowMove" value="1" className={`${buttonVariants.primary} w-full`}>
      Move it here from {String(state.details.fromCaseName ?? "the other set")}
    </button>
  );
}

/** Scan (continuous camera or handheld scanner) or type codes to pack items into this case. */
export function PackByCode({ action }: { action: Action }) {
  const ref = useRef<HTMLDivElement>(null);
  const submit = (code: string) => {
    const input = ref.current?.querySelector<HTMLInputElement>('input[name="code"]');
    if (!input) return;
    input.value = code;
    input.form?.requestSubmit();
  };
  return (
    <div ref={ref} className="space-y-3">
      <BarcodeCamera onCode={submit} continuous compact label="Scan to pack" />
      <ActionForm action={action} className="space-y-2">
        <div className="flex gap-2">
          <Field
            name="code"
            id="pack-code"
            placeholder="Barcode, serial or asset no."
            aria-label="Code to pack"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="characters"
            enterKeyHint="go"
            className="flex-1"
          />
          <SubmitButton pendingText="…" aria-label="Pack code">
            Pack
          </SubmitButton>
        </div>
        <MoveConfirm />
      </ActionForm>
    </div>
  );
}

export function SmallActionButton({ action, label, variant = "ghost" }: { action: Action; label: string; variant?: "ghost" | "danger" | "secondary" }) {
  return (
    <ActionForm action={action}>
      <SubmitButton variant={variant} className="!px-2 !py-1 text-xs" pendingText="…">
        {label}
      </SubmitButton>
    </ActionForm>
  );
}

/** Pack / take out several interchangeable units: "[ 2 ] of 10 · Pack". */
export function UnitsButton({ action, units, suggested, move, label }: { action: Action; units: number; suggested?: number; move?: boolean; label: string }) {
  return (
    <ActionForm action={action} className="flex items-center gap-1.5">
      {move && <input type="hidden" name="allowMove" value="1" />}
      <input
        type="number"
        name="units"
        min={1}
        max={units}
        defaultValue={Math.min(Math.max(suggested ?? units, 1), units)}
        inputMode="numeric"
        aria-label={`How many (of ${units})`}
        className="w-14 rounded-md border border-border bg-surface px-1.5 py-1 text-right text-xs tabular-nums"
      />
      <span className="text-xs whitespace-nowrap text-muted">of {units}</span>
      <SubmitButton variant={label === "Take out" ? "ghost" : "secondary"} className="!px-2.5 !py-1 text-xs" pendingText="…">
        {move && label === "Pack" ? "Move here" : label}
      </SubmitButton>
      <MoveConfirmInline />
    </ActionForm>
  );
}

function MoveConfirmInline() {
  const state = useFormState();
  if (!state?.details?.needsMoveConfirmation) return null;
  return (
    <button type="submit" name="allowMove" value="1" className={`${buttonVariants.primary} !px-2.5 !py-1 text-xs`}>
      Move
    </button>
  );
}
