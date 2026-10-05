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
      Move it here from {String(state.details.fromCaseName ?? "the other case")}
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

/** One-click pack (or explicit move) button for the picker list. */
export function PackButton({ action, move }: { action: Action; move: boolean }) {
  return (
    <ActionForm action={action}>
      {move && <input type="hidden" name="allowMove" value="1" />}
      <SubmitButton variant="secondary" className="!px-2.5 !py-1 text-xs" pendingText="…">
        {move ? "Move here" : "Pack"}
      </SubmitButton>
    </ActionForm>
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
