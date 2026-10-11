import Link from "next/link";
import { ActionForm, Field, Select, SubmitButton } from "@/components/forms";
import { Card, CardHeader, NoPermission } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { getProjectSummary } from "@/server/domain/projects";
import { listRentalHouses } from "@/server/domain/rental-houses";
import { getT } from "@/server/i18n";
import { orNotFound } from "@/server/pages";
import { linkRentalHouseAction } from "../../actions";

export default async function ProjectRentalHousesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  if (!hasRole(ctx, "member")) return <NoPermission />;
  const db = getDb();
  const [summary, all] = await Promise.all([orNotFound(getProjectSummary(db, ctx, id)), listRentalHouses(db, ctx)]);
  const t = await getT();
  const action = linkRentalHouseAction.bind(null, id);
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        {summary.rentalHouses.map((rh) => (
          <Card key={rh.id} className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <Link href={`/settings/rental-houses/${rh.id}`} className="font-semibold hover:underline">
                {rh.name}
              </Link>
              <span className="text-xs text-muted tabular-nums">
                {t("{n} on project · {returned} returned", { n: rh.on_project, returned: rh.returned })}
              </span>
            </div>
            <ActionForm action={action} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="rentalHouseId" value={rh.id} />
              <Field label={t("Order / account reference")} name="orderReference" defaultValue={rh.order_reference} />
              <Field label={t("Contact at rental house")} name="contactName" defaultValue={rh.contact_name} />
              <div className="sm:col-span-2">
                <SubmitButton variant="secondary">{t("Save")}</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        ))}
      </div>
      <Card className="self-start">
        <CardHeader title={t("Link another rental house")} />
        <div className="p-4">
          {all.length === 0 ? (
            <p className="text-sm text-muted">
              {t("No rental houses yet.")}{" "}
              <Link href="/settings/rental-houses/new" className="text-accent hover:underline">
                {t("Create one")}
              </Link>
              .
            </p>
          ) : (
            <ActionForm action={action} className="space-y-3" resetOnSuccess>
              <Select
                label={t("Rental house")}
                name="rentalHouseId"
                placeholder={t("Choose…")}
                options={all.filter((r) => !summary.rentalHouses.some((x) => x.id === r.id)).map((r) => ({ value: r.id, label: r.name }))}
              />
              <Field label={t("Order / account reference")} name="orderReference" />
              <Field label={t("Contact at rental house")} name="contactName" />
              <SubmitButton>{t("Link rental house")}</SubmitButton>
            </ActionForm>
          )}
          <p className="mt-4 text-xs text-muted">
            {t(
              "A project can hold equipment from any number of rental houses. Returns never close the relationship — what is still out is always shown per rental house.",
            )}
          </p>
        </div>
      </Card>
    </div>
  );
}
