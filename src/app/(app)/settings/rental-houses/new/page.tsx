import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, NoPermission, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { hasRole } from "@/server/domain/context";
import { createRentalHouseAction } from "../../actions";
import { RentalHouseFields } from "../rental-house-fields";

export const metadata = { title: "New rental house" };

export default async function NewRentalHousePage() {
  if (!hasRole(await getCtx(), "member")) return <NoPermission />;
  return (
    <>
      <PageHeader title="New rental house" back={{ href: "/settings/rental-houses", label: "Rental houses" }} />
      <Card className="max-w-2xl p-5">
        <ActionForm action={createRentalHouseAction} className="space-y-5">
          <RentalHouseFields />
          <SubmitButton>Create rental house</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
