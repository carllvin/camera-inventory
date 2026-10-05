import { ActionForm, Field, Select, SubmitButton, TextArea } from "@/components/forms";
import { Card, NoPermission, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { getItemDetail } from "@/server/domain/equipment-items";
import { listRentalHouses } from "@/server/domain/rental-houses";
import { assertUuid, orNotFound } from "@/server/pages";
import { updateItemAction } from "../../actions";

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
    </>
  );
}
