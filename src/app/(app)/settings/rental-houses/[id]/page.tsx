import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardHeader, KeyValues, PageHeader } from "@/components/ui";
import { PROJECT_STATUS_LABEL } from "@/lib/format";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { getRentalHouse, getRentalHouseProjects } from "@/server/domain/rental-houses";
import { getT } from "@/server/i18n";
import { assertUuid, orNotFound } from "@/server/pages";
import { updateRentalHouseAction } from "../../actions";
import { RentalHouseFields } from "../rental-house-fields";

export default async function RentalHousePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  assertUuid(id);
  const ctx = await getCtx();
  const db = getDb();
  const [rh, projects] = await Promise.all([orNotFound(getRentalHouse(db, ctx, id)), getRentalHouseProjects(db, ctx, id)]);
  const t = await getT();
  return (
    <>
      <PageHeader title={rh.name} subtitle={rh.aliases.length ? t("Also known as {aliases}", { aliases: rh.aliases.join(", ") }) : undefined}
        back={{ href: "/settings/rental-houses", label: t("Rental houses") }} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_22rem]">
        <Card className="p-5">
          {hasRole(ctx, "member") ? (
            <ActionForm action={updateRentalHouseAction.bind(null, id)} className="space-y-5">
              <RentalHouseFields defaults={rh} />
              <SubmitButton>{t("Save")}</SubmitButton>
            </ActionForm>
          ) : (
            <KeyValues items={[{ label: t("Phone"), value: rh.phone }, { label: t("Email"), value: rh.email }, { label: t("Website"), value: rh.website }, { label: t("Address"), value: rh.address }, { label: t("Notes"), value: rh.notes }]} />
          )}
        </Card>
        <Card className="self-start">
          <CardHeader title={t("Equipment out on projects")} />
          {projects.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted">{t("Nothing from {name} is out right now.", { name: rh.shortName ?? rh.name })}</p>
          ) : (
            <ul className="divide-y divide-border">
              {projects.map((p) => (
                <li key={p.project_id}>
                  <Link href={`/projects/${p.project_id}?rentalHouseId=${id}`} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-surface-2">
                    <span>
                      <span className="font-medium">{p.project_name}</span>
                      <span className="ml-2 text-xs text-muted">{PROJECT_STATUS_LABEL[p.status] && t(PROJECT_STATUS_LABEL[p.status]!)}</span>
                    </span>
                    <span className="tabular-nums">{p.on_project}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
