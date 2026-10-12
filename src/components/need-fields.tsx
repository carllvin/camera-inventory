import type { T } from "@/lib/i18n/core";
import type { PlannedNeed } from "@/server/domain/planned-needs";
import { DEFAULT_ORDER_DAYS } from "@/server/domain/planned-needs";
import { Field, Select } from "./forms";
import { TypePicker } from "./type-picker";

/** Fields of a planned extra-equipment entry (new or existing); `key` keeps ids unique on the page. */
export function NeedFields({
  t,
  need,
  formKey,
  rentalHouses,
  projects,
  from,
}: {
  t: T;
  need: PlannedNeed | null;
  formKey: string;
  rentalHouses: { value: string; label: string }[];
  /** Only when the project is not fixed (e.g. the workspace calendar). */
  projects?: { value: string; label: string; selected?: boolean }[];
  /** Preset start day (a day clicked in the calendar). */
  from?: string;
}) {
  const n = need;
  const k = formKey;
  return (
    <>
      {projects && (
        <Select
          label={t("Project")}
          name="projectId"
          id={`project-${k}`}
          required
          placeholder={t("Choose…")}
          defaultValue={projects.find((p) => p.selected)?.value ?? null}
          options={projects.map(({ value, label }) => ({ value, label }))}
          className="sm:col-span-2"
        />
      )}
      <TypePicker
        name="equipmentTypeId"
        id={`type-${k}`}
        label={t("Equipment type")}
        defaultValue={n?.equipmentTypeId && n.typeName ? { id: n.equipmentTypeId, name: n.typeName } : null}
        emptyLabel={t("No type (describe it below)")}
        className="sm:col-span-2"
      />
      <Field label={t("Description")} name="label" id={`label-${k}`} defaultValue={n && n.label !== n.typeName ? n.label : ""} hint={t("Optional with a type; e.g. “Technocrane remote head”")} className="sm:col-span-2" />
      <Field label={t("Quantity")} name="quantity" id={`qty-${k}`} type="number" min={1} max={999} defaultValue={n?.quantity ?? 1} />
      <Select label={t("Rental house")} name="rentalHouseId" id={`rh-${k}`} placeholder={t("Any")} defaultValue={n?.rentalHouseId ?? null} options={rentalHouses} />
      <Field label={t("Needed from")} name="needFrom" id={`from-${k}`} type="date" required defaultValue={n?.needFrom ?? from ?? ""} />
      <Field label={t("Until (return)")} name="needUntil" id={`until-${k}`} type="date" required defaultValue={n?.needUntil ?? from ?? ""} />
      <Field label={t("Order by")} name="orderBy" id={`order-${k}`} type="date" defaultValue={n?.orderBy ?? ""} hint={t("Reminder day; empty = {n} days before", { n: DEFAULT_ORDER_DAYS })} />
      <Field label={t("Notes")} name="notes" id={`notes-${k}`} defaultValue={n?.notes ?? ""} />
    </>
  );
}
