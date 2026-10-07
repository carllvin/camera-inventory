import { Thumb, groupItems } from "@/components/equipment-table";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardHeader, EmptyState, Mono } from "@/components/ui";
import { getExtractor } from "@/server/ai";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { listCases } from "@/server/domain/cases";
import { requireRole } from "@/server/domain/context";
import { listItems } from "@/server/domain/equipment-items";
import { assertUuid } from "@/server/pages";
import { removeEquipmentAction } from "../../actions";

export const metadata = { title: "Remove equipment" };

/** Take cases or items off the project without a full return-note review; optionally attach the note as a double check. */
export default async function RemoveEquipmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ caseId?: string; items?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  assertUuid(id);
  const ctx = await getCtx();
  requireRole(ctx, "member");
  const db = getDb();
  const [items, cases] = await Promise.all([listItems(db, ctx, { projectId: id, limit: 500 }), listCases(db, ctx, { projectId: id })]);
  if (items.length === 0) return <EmptyState title="Nothing on this project" />;
  const rows = groupItems(items);
  const preselected = new Set((sp.items ?? "").split(","));
  const unitsIn = (caseId: string) => items.filter((i) => i.caseId === caseId).reduce((n, i) => n + i.quantity, 0);
  const ai = getExtractor().available;
  const check = "size-4 shrink-0 accent-[var(--color-accent)]";

  return (
    <ActionForm action={removeEquipmentAction.bind(null, id)} className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-6">
        {cases.length > 0 && (
          <Card>
            <CardHeader title="Whole cases" />
            <ul className="divide-y divide-border">
              {cases.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5">
                    <input type="checkbox" name="case" value={c.id} defaultChecked={sp.caseId === c.id} className={check} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                    <span className="text-xs text-muted tabular-nums">{unitsIn(c.id)} pcs</span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="border-t border-border px-4 py-2 text-xs text-muted">A case goes with everything in it and is archived (its history stays).</p>
          </Card>
        )}
        <Card>
          <CardHeader title="Single items" />
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2">
                <input type="checkbox" name="row" value={r.id} id={`row-${r.id}`} defaultChecked={r.itemIds.some((i) => preselected.has(i))} aria-label={`Remove ${r.typeName}${r.serialNumber ? ` ${r.serialNumber}` : ""}`} className={check} />
                <input type="hidden" name={`ids_${r.id}`} value={r.itemIds.join(",")} />
                <Thumb photoId={r.imageId} name={r.typeName} className="size-9" />
                <label htmlFor={`row-${r.id}`} className="min-w-0 flex-1 cursor-pointer">
                  <div className="truncate text-sm">{r.typeName}</div>
                  <div className="truncate text-xs text-muted">
                    <Mono>{r.serialNumber ? `SN ${r.serialNumber}` : "No serial"}</Mono>
                    {r.caseName && ` · ${r.caseName}`}
                    {r.rentalHouseShort || r.rentalHouseName ? ` · ${r.rentalHouseShort ?? r.rentalHouseName}` : ""}
                  </div>
                </label>
                {r.units > 1 && (
                  <span className="flex items-center gap-1 text-xs text-muted">
                    <input
                      type="number"
                      name={`units_${r.id}`}
                      min={1}
                      max={r.units}
                      defaultValue={r.units}
                      inputMode="numeric"
                      aria-label={`How many ${r.typeName} (of ${r.units})`}
                      className="w-14 rounded-md border border-border bg-surface px-1.5 py-1 text-right tabular-nums"
                    />
                    of {r.units}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <Card className="space-y-4 p-4">
          <fieldset className="space-y-1.5 text-sm">
            <legend className="mb-1 font-medium">Why?</legend>
            <label className="flex items-start gap-2">
              <input type="radio" name="reason" value="returned" defaultChecked className="mt-0.5" />
              <span>
                Returned to the rental house
                <span className="block text-xs text-muted">Owned equipment becomes available again.</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="reason" value="removed" className="mt-0.5" />
              <span>
                Not on this project (added by mistake, never arrived …)
              </span>
            </label>
          </fieldset>
          <div className="space-y-1">
            <label htmlFor="remove-note" className="text-sm font-medium">
              Note <span className="font-normal text-muted">(optional)</span>
            </label>
            <input id="remove-note" name="note" className="input" placeholder="e.g. picked up by the driver" />
          </div>
          <div className="space-y-1">
            <label htmlFor="remove-file" className="text-sm font-medium">
              Photo of the return note <span className="font-normal text-muted">(optional)</span>
            </label>
            <input id="remove-file" type="file" name="file" accept="image/*,application/pdf" capture="environment" multiple className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm" />
            <p className="text-xs text-muted">
              {ai
                ? "Double check: the note is read and compared with what you removed — anything missing or extra is shown."
                : "Kept with the removal as proof. (AI reading is not configured, so lines are compared after you enter them.)"}
            </p>
          </div>
          <SubmitButton variant="danger" className="w-full" pendingText="Removing…">
            Remove selected
          </SubmitButton>
          <p className="text-xs text-muted">Nothing is deleted: each item keeps its full history and can be added again later.</p>
        </Card>
      </div>
    </ActionForm>
  );
}
