"use client";

import { Field, TextArea } from "@/components/forms";

export function CaseFields({ defaults = {} }: { defaults?: { name?: string; code?: string | null; barcode?: string | null; description?: string | null; notes?: string | null } }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Name" name="name" defaultValue={defaults.name} required placeholder="A-Cam Case" />
      <Field label="Label / code" name="code" defaultValue={defaults.code} placeholder="A-CAM 1" hint="Short text written on the case" />
      <Field label="QR / barcode" name="barcode" defaultValue={defaults.barcode} spellCheck={false} hint="Scan the case label to open this page" className="sm:col-span-2" />
      <TextArea label="Description" name="description" defaultValue={defaults.description} className="sm:col-span-2" />
      <TextArea label="Notes" name="notes" defaultValue={defaults.notes} className="sm:col-span-2" />
    </div>
  );
}
