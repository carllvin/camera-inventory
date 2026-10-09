import { ActionForm, Field, Select, SubmitButton, TextArea } from "@/components/forms";
import { Card, NoPermission, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { getItemDetail } from "@/server/domain/equipment-items";
import { listRentalHouses } from "@/server/domain/rental-houses";
import { assertUuid, orNotFound } from "@/server/pages";
import { changeItemTypeAction, updateItemAction } from "../../actions";
import { TypePicker } from "@/components/type-picker";

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  assertUuid(id);
  const ctx = await getCtx();
  if (!hasRole(ctx, "member")) return <NoPermission />;
  const db = getDb();
  const [d, rentalHouses] = await Promise.all([orNotFound(getItemDetail(db, ctx, id)), listRentalHouses(db, ctx)]);
  const { item } = d;
  return (
    <>
      <PageHeader title={`Edit ${d.label}`} back={{ href: `/equipment/${id}`, label: "Back to item" }} />
      <Card className="max-w-2xl p-5">
        <ActionForm action={updateItemAction.bind(null, id)} className="space-y-5">
          <input type="hidden" name="expectedVersion" value={item.version} />
          <div className="grid gap-4 sm:grid-cols-2">
            {item.trackingMode === "bulk" ? (
              <Field label="Quantity" name="quantity" type="number" min={1} defaultValue={item.quantity} />
            ) : (
              <Field label="Serial number" name="serialNumber" defaultValue={item.serialNumber} spellCheck={false} />
            )}
            <Field label="Asset number" name="assetNumber" defaultValue={item.assetNumber} spellCheck={false} />
            <Field label="QR / barcode" name="barcode" defaultValue={item.barcode} spellCheck={false} />
            <Select
              label="Rental house"
              name="rentalHouseId"
              placeholder="Owned (not rented)"
              defaultValue={item.rentalHouseId}
              options={rentalHouses.map((r) => ({ value: r.id, label: r.name }))}
            />
          </div>
          {item.trackingMode === "bulk" && <input type="hidden" name="serialNumber" value={item.serialNumber ?? ""} />}
          <TextArea label="Notes" name="notes" defaultValue={item.notes} rows={4} />
          <p className="text-xs text-muted">Status, condition and project are changed from the item page so each change is recorded on its own.</p>
          <SubmitButton>Save changes</SubmitButton>
        </ActionForm>
      </Card>
      <Card className="mt-6 max-w-2xl p-5">
        <h2 className="text-sm font-semibold">Equipment type</h2>
        <p className="mt-1 mb-3 text-sm text-muted">
          Now <strong className="text-text">{d.type.name}</strong>. Wrong type (e.g. picked by mistake when importing)? Choose the right one; the item keeps its history.
        </p>
        <ActionForm action={changeItemTypeAction.bind(null, id)} className="flex flex-wrap items-end gap-3">
          <TypePicker name="typeId" label="Right type" className="min-w-64 flex-1" />
          <SubmitButton variant="secondary">Change type</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
