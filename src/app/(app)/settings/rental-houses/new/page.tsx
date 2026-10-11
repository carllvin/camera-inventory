import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, NoPermission, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { hasRole } from "@/server/domain/context";
import { getT } from "@/server/i18n";
import { createRentalHouseAction } from "../../actions";
import { RentalHouseFields } from "../rental-house-fields";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("New rental house") };
}

export default async function NewRentalHousePage() {
  if (!hasRole(await getCtx(), "member")) return <NoPermission />;
  const t = await getT();
  return (
    <>
      <PageHeader title={t("New rental house")} back={{ href: "/settings/rental-houses", label: t("Rental houses") }} />
      <Card className="max-w-2xl p-5">
        <ActionForm action={createRentalHouseAction} className="space-y-5">
          <RentalHouseFields />
          <SubmitButton>{t("Create rental house")}</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
