"use client";

import { Field, TextArea } from "@/components/forms";
import { useT } from "@/components/i18n";

export interface RentalHouseDefaults {
  name?: string;
  shortName?: string | null;
  aliases?: string[];
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
}

export function RentalHouseFields({ defaults = {} }: { defaults?: RentalHouseDefaults }) {
  const t = useT();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("Name")} name="name" defaultValue={defaults.name} required />
      <Field label={t("Short name")} name="shortName" defaultValue={defaults.shortName} placeholder={t("e.g. ARRI")} />
      <TextArea
        label={t("Aliases")}
        name="aliases"
        defaultValue={(defaults.aliases ?? []).join(", ")}
        hint={t("Other spellings on delivery notes, comma separated — used to recognize the rental house")}
        className="sm:col-span-2"
      />
      <Field label={t("Phone")} name="phone" type="tel" defaultValue={defaults.phone} />
      <Field label={t("Email")} name="email" type="email" defaultValue={defaults.email} />
      <Field label={t("Website")} name="website" type="url" defaultValue={defaults.website} className="sm:col-span-2" />
      <TextArea label={t("Address")} name="address" defaultValue={defaults.address} className="sm:col-span-2" />
      <TextArea label={t("Notes")} name="notes" defaultValue={defaults.notes} className="sm:col-span-2" />
    </div>
  );
}
