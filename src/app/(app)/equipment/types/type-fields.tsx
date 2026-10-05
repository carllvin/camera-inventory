"use client";

import { Field, Select, TextArea } from "@/components/forms";

export interface TypeDefaults {
  manufacturer?: string;
  model?: string;
  name?: string;
  categoryId?: string | null;
  aliases?: string[];
  description?: string | null;
  specs?: Record<string, unknown>;
  defaultTrackingMode?: string;
}

export function TypeFields({ defaults = {}, categories }: { defaults?: TypeDefaults; categories: { value: string; label: string }[] }) {
  const specsText = Object.entries(defaults.specs ?? {})
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join("\n");
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Manufacturer" name="manufacturer" defaultValue={defaults.manufacturer} required placeholder="ARRI" />
      <Field label="Model" name="model" defaultValue={defaults.model} required placeholder="ALEXA 35" />
      <Field
        label="Display name"
        name="name"
        defaultValue={defaults.name && defaults.name !== `${defaults.manufacturer} ${defaults.model}` ? defaults.name : ""}
        placeholder="Defaults to “Manufacturer Model”"
        className="sm:col-span-2"
      />
      <Select label="Category" name="categoryId" placeholder="Uncategorized" defaultValue={defaults.categoryId} options={categories} />
      <Select
        label="Tracking"
        name="defaultTrackingMode"
        defaultValue={defaults.defaultTrackingMode ?? "serialized"}
        options={[
          { value: "serialized", label: "Individually (serial numbers)" },
          { value: "bulk", label: "By quantity (cables, sandbags…)" },
        ]}
      />
      <TextArea
        label="Aliases"
        name="aliases"
        defaultValue={(defaults.aliases ?? []).join(", ")}
        placeholder="A35, Alexa35, ALEXA 35 Camera Set"
        hint="Other names seen on delivery notes — used for search and matching. Comma or line separated."
        className="sm:col-span-2"
      />
      <TextArea
        label="Technical data"
        name="specs"
        defaultValue={specsText}
        placeholder={"mount: LPL\nweight: 2.9 kg\npower: 24 V"}
        hint="One “key: value” per line"
        rows={4}
        className="sm:col-span-2"
      />
      <TextArea label="Description" name="description" defaultValue={defaults.description} className="sm:col-span-2" />
    </div>
  );
}
