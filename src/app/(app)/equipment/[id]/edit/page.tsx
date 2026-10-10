import Link from "next/link";
import { ActionForm, Field, Select, SubmitButton, TextArea } from "@/components/forms";
import { TypePicker } from "@/components/type-picker";
import { Card, NoPermission, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { getItemDetail } from "@/server/domain/equipment-items";
import { listRentalHouses } from "@/server/domain/rental-houses";
import { assertUuid, orNotFound } from "@/server/pages";
import { getT } from "@/server/i18n";
import { updateItemAction } from "../../actions";

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  assertUuid(id);
  const ctx = await getCtx();
  const t = await getT();
  if (!hasRole(ctx, "member")) return <NoPermission />;
  const db = getDb();
  const [d, rentalHouses] = await Promise.all([orNotFound(getItemDetail(db, ctx, id)), listRentalHouses(db, ctx)]);
  const { item } = d;
  const bulk = item.trackingMode === "bulk";
  return (
    <>
      <PageHeader title={t("Edit {name}", { name: d.label })} back={{ href: `/equipment/${id}`, label: t("Back to item") }} />
      <Card className="max-w-2xl p-5">
        <ActionForm action={updateItemAction.bind(null, id)} className="space-y-4">
          <input type="hidden" name="expectedVersion" value={item.version} />
          {/* Changing it here corrects a type picked wrongly (e.g. when importing); the item keeps its history. */}
          <TypePicker name="typeId" label={t("Equipment type")} defaultValue={{ id: d.type.id, name: d.type.name }} />
          <div className="grid gap-4 sm:grid-cols-2">
            {bulk ? (
              <Field label={t("Quantity")} name="quantity" type="number" min={1} defaultValue={item.quantity} />
            ) : (
              <Field label={t("Serial number")} name="serialNumber" defaultValue={item.serialNumber} spellCheck={false} />
            )}
            <Field label={t("Asset number")} name="assetNumber" defaultValue={item.assetNumber} spellCheck={false} />
            <Field label={t("QR / barcode")} name="barcode" defaultValue={item.barcode} spellCheck={false} />
            <Select
              label={t("Rental house")}
              name="rentalHouseId"
              placeholder={t("Owned (not rented)")}
              defaultValue={item.rentalHouseId}
              options={rentalHouses.map((r) => ({ value: r.id, label: r.name }))}
            />
          </div>
          {bulk && <input type="hidden" name="serialNumber" value={item.serialNumber ?? ""} />}
          <TextArea label={t("Notes")} name="notes" defaultValue={item.notes} rows={2} />
          <div className="flex items-center gap-4 pt-1">
            <SubmitButton>{t("Save")}</SubmitButton>
            <Link href={`/equipment/${id}`} className="text-sm text-muted hover:text-text">
              {t("Cancel")}
            </Link>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
