"use client";

import { Field, Select, TextArea } from "@/components/forms";
import { useT } from "@/components/i18n";

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
  const t = useT();
  const specsText = Object.entries(defaults.specs ?? {})
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join("\n");
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("Manufacturer")} name="manufacturer" defaultValue={defaults.manufacturer} required placeholder="ARRI" />
      <Field label={t("Model")} name="model" defaultValue={defaults.model} required placeholder="ALEXA 35" />
      <Field
        label={t("Display name")}
        name="name"
        defaultValue={defaults.name && defaults.name !== `${defaults.manufacturer} ${defaults.model}` ? defaults.name : ""}
        placeholder={t("Defaults to “Manufacturer Model”")}
        className="sm:col-span-2"
      />
      <Select label={t("Category")} name="categoryId" placeholder={t("Uncategorized")} defaultValue={defaults.categoryId} options={categories} />
      <Select
        label={t("Tracking")}
        name="defaultTrackingMode"
        defaultValue={defaults.defaultTrackingMode ?? "serialized"}
        options={[
          { value: "serialized", label: t("Individually (serial numbers)") },
          { value: "bulk", label: t("By quantity (cables, sandbags…)") },
        ]}
      />
      <TextArea
        label={t("Aliases")}
        name="aliases"
        defaultValue={(defaults.aliases ?? []).join(", ")}
        placeholder="A35, Alexa35, ALEXA 35 Camera Set"
        hint={t("Other names seen on delivery notes — used for search and matching. Comma or line separated.")}
        className="sm:col-span-2"
      />
      <TextArea
        label={t("Technical data")}
        name="specs"
        defaultValue={specsText}
        placeholder={t("mount: LPL\nweight: 2.9 kg\npower: 24 V")}
        hint={t("One “key: value” per line")}
        rows={4}
        className="sm:col-span-2"
      />
      <TextArea label={t("Description")} name="description" defaultValue={defaults.description} className="sm:col-span-2" />
    </div>
  );
}
