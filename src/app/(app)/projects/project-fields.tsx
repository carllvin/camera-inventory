"use client";

import { Field, Select, TextArea } from "@/components/forms";
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
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Project name" name="name" defaultValue={defaults.name} required className="sm:col-span-2" autoFocus />
      <Field label="Code" name="code" defaultValue={defaults.code} placeholder="e.g. FFX" maxLength={20} />
      <Select
        label="Status"
        name="status"
        defaultValue={defaults.status ?? "prep"}
        options={Object.entries(PROJECT_STATUS_LABEL).map(([value, label]) => ({ value, label }))}
      />
      <Field label="Production company" name="productionCompany" defaultValue={defaults.productionCompany} className="sm:col-span-2" />
      <Field label="Start" name="startDate" type="date" defaultValue={defaults.startDate} />
      <Field label="End" name="endDate" type="date" defaultValue={defaults.endDate} />
      <TextArea label="Notes" name="description" defaultValue={defaults.description} className="sm:col-span-2" />
    </div>
  );
}
