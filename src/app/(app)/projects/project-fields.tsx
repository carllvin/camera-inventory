"use client";

import { Field, Select, TextArea } from "@/components/forms";
import { useT } from "@/components/i18n";
import { PROJECT_STATUS_LABEL } from "@/lib/format";

export interface ProjectDefaults {
  name?: string;
  code?: string | null;
  status?: string;
  productionCompany?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  description?: string | null;
}

export function ProjectFields({ defaults = {} }: { defaults?: ProjectDefaults }) {
  const t = useT();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("Project name")} name="name" defaultValue={defaults.name} required className="sm:col-span-2" autoFocus />
      <Field label={t("Code")} name="code" defaultValue={defaults.code} placeholder={t("e.g. FFX")} maxLength={20} />
      <Select
        label={t("Status")}
        name="status"
        defaultValue={defaults.status ?? "prep"}
        options={Object.entries(PROJECT_STATUS_LABEL).map(([value, label]) => ({ value, label: t(label) }))}
      />
      <Field label={t("Production company")} name="productionCompany" defaultValue={defaults.productionCompany} className="sm:col-span-2" />
      <Field label={t("Start")} name="startDate" type="date" defaultValue={defaults.startDate} />
      <Field label={t("End")} name="endDate" type="date" defaultValue={defaults.endDate} />
      <TextArea label={t("Notes")} name="description" defaultValue={defaults.description} className="sm:col-span-2" />
    </div>
  );
}
