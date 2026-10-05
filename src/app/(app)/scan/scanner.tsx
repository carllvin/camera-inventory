"use client";

import Link from "next/link";
import { useRef } from "react";
import { BarcodeCamera } from "@/components/barcode-camera";
import { ActionForm, Field, SubmitButton, useFormState } from "@/components/forms";
import { lookupCodeAction } from "./actions";

function NotFoundHelp() {
  const state = useFormState();
  const code = state?.details?.code as string | undefined;
  if (!code) return null;
  return (
    <p className="text-sm text-muted">
      <Link href={`/search?q=${encodeURIComponent(code)}`} className="text-accent hover:underline">
        Search for “{code}”
      </Link>{" "}
      or{" "}
      <Link href="/equipment/new" className="text-accent hover:underline">
        add it as new equipment
      </Link>
      .
    </p>
  );
}

/** Look up equipment or a case by code: camera where supported, typing everywhere. */
export function Scanner() {
  const formRef = useRef<HTMLDivElement>(null);
  const submit = (value: string) => {
    const input = formRef.current?.querySelector<HTMLInputElement>('input[name="code"]');
    if (!input) return;
    input.value = value;
    input.form?.requestSubmit();
  };
  return (
    <div className="space-y-5">
      <BarcodeCamera onCode={submit} label="Scan QR / barcode with camera" />
      <div ref={formRef}>
        <ActionForm action={lookupCodeAction} className="space-y-3">
          <Field label="Code" name="code" placeholder="QR / barcode, serial or asset number" autoComplete="off" spellCheck={false} autoCapitalize="characters" enterKeyHint="search" />
          <SubmitButton pendingText="Looking up…">Find</SubmitButton>
          <NotFoundHelp />
        </ActionForm>
      </div>
    </div>
  );
}
