"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionForm, Field, Select, SubmitButton, TextArea } from "@/components/forms";
import { CONDITION_LABEL } from "@/lib/format";
import { createItemAction } from "./actions";

interface Option {
  value: string;
  label: string;
}

export function ItemCreateForm({
  types,
  rentalHouses,
  projects,
  defaults,
}: {
  types: { id: string; name: string; defaultTrackingMode: "serialized" | "bulk" }[];
  rentalHouses: Option[];
  projects: Option[];
  defaults: { typeId?: string; projectId?: string; rentalHouseId?: string };
}) {
  const [typeId, setTypeId] = useState(defaults.typeId ?? "");
  const type = types.find((t) => t.id === typeId);
  const bulk = type?.defaultTrackingMode === "bulk";
  const returnTo = `/equipment/new?${new URLSearchParams(
    Object.entries({ projectId: defaults.projectId ?? "", rentalHouseId: defaults.rentalHouseId ?? "" }).filter(([, v]) => v),
  )}`;
  return (
    <ActionForm action={createItemAction} className="space-y-5">
      <div>
        <Select
          label="Equipment type"
          name="equipmentTypeId"
          placeholder="Choose a model…"
          defaultValue={typeId}
          onChange={(e) => setTypeId(e.target.value)}
          options={types.map((t) => ({ value: t.id, label: t.name }))}
          required
        />
        <p className="mt-1 text-xs text-muted">
          Not listed?{" "}
          <Link href={`/equipment/types/new?returnTo=${encodeURIComponent(returnTo)}`} className="text-accent hover:underline">
            Create a new equipment type
          </Link>
        </p>
      </div>
      <input type="hidden" name="trackingMode" value={bulk ? "bulk" : "serialized"} />
      <div className="grid gap-4 sm:grid-cols-2">
        {bulk ? (
          <Field label="Quantity" name="quantity" type="number" min={1} defaultValue={1} required hint="Bulk item: interchangeable units without individual serials" />
        ) : (
          <Field label="Serial number" name="serialNumber" autoComplete="off" spellCheck={false} />
        )}
        <Field label="Asset number" name="assetNumber" autoComplete="off" spellCheck={false} hint="Rental-house inventory number" />
        <Field label="QR / barcode" name="barcode" autoComplete="off" spellCheck={false} />
        <Select label="Rental house" name="rentalHouseId" placeholder="Owned (not rented)" defaultValue={defaults.rentalHouseId} options={rentalHouses} />
        <Select label="Project" name="projectId" placeholder="Not on a project" defaultValue={defaults.projectId} options={projects} />
        <Select
          label="Condition"
          name="condition"
          defaultValue="ok"
          options={Object.entries(CONDITION_LABEL).map(([value, label]) => ({ value, label }))}
        />
      </div>
      <TextArea label="Notes" name="notes" />
      <div className="flex flex-wrap gap-2">
        <SubmitButton>Create item</SubmitButton>
        <SubmitButton variant="secondary" name="another" value="1">
          Create &amp; add another
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
