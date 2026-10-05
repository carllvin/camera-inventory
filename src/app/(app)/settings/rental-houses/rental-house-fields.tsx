"use client";

import { Field, TextArea } from "@/components/forms";

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
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Name" name="name" defaultValue={defaults.name} required />
      <Field label="Short name" name="shortName" defaultValue={defaults.shortName} placeholder="e.g. ARRI" />
      <TextArea
        label="Aliases"
        name="aliases"
        defaultValue={(defaults.aliases ?? []).join(", ")}
        hint="Other spellings on delivery notes, comma separated — used to recognize the rental house"
        className="sm:col-span-2"
      />
      <Field label="Phone" name="phone" type="tel" defaultValue={defaults.phone} />
      <Field label="Email" name="email" type="email" defaultValue={defaults.email} />
      <Field label="Website" name="website" type="url" defaultValue={defaults.website} className="sm:col-span-2" />
      <TextArea label="Address" name="address" defaultValue={defaults.address} className="sm:col-span-2" />
      <TextArea label="Notes" name="notes" defaultValue={defaults.notes} className="sm:col-span-2" />
    </div>
  );
}
