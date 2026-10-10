import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, NoPermission, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { getCategoryTree } from "@/server/domain/categories";
import { hasRole } from "@/server/domain/context";
import { getEquipmentType } from "@/server/domain/equipment-types";
import { assertUuid, orNotFound } from "@/server/pages";
import { updateTypeAction } from "../../../actions";
import { TypeFields } from "../../type-fields";
import { getT } from "@/server/i18n";

export default async function EditTypePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  assertUuid(id);
  const ctx = await getCtx();
  const t = await getT();
  if (!hasRole(ctx, "member")) return <NoPermission />;
  const db = getDb();
  const [et, { flat }] = await Promise.all([orNotFound(getEquipmentType(db, ctx, id)), getCategoryTree(db, ctx)]);
  return (
    <>
      <PageHeader title={t("Edit {name}", { name: et.name })} back={{ href: `/equipment/types/${id}`, label: et.name }} />
      <Card className="max-w-2xl p-5">
        <ActionForm action={updateTypeAction.bind(null, id)} className="space-y-5">
          <TypeFields defaults={et} categories={flat.map((c) => ({ value: c.id, label: c.path }))} />
          <SubmitButton>{t("Save changes")}</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
