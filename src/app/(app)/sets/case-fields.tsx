"use client";

import { Field, TextArea } from "@/components/forms";
import { useT } from "@/components/i18n";

export function CaseFields({ defaults = {} }: { defaults?: { name?: string; code?: string | null; barcode?: string | null; description?: string | null; notes?: string | null } }) {
  const t = useT();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("Name")} name="name" defaultValue={defaults.name} required placeholder="A-Cam Set" />
      <Field label={t("Label / code")} name="code" defaultValue={defaults.code} placeholder="A-CAM 1" hint={t("Short text written on the set")} />
      <Field label={t("QR / barcode")} name="barcode" defaultValue={defaults.barcode} spellCheck={false} hint={t("Scan the set label to open this page")} className="sm:col-span-2" />
      <TextArea label={t("Description")} name="description" defaultValue={defaults.description} className="sm:col-span-2" />
      <TextArea label={t("Notes")} name="notes" defaultValue={defaults.notes} className="sm:col-span-2" />
    </div>
  );
}
