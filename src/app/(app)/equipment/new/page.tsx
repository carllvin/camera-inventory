import Link from "next/link";
import { Card, NoPermission, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { getItemDetail } from "@/server/domain/equipment-items";
import { getEquipmentType } from "@/server/domain/equipment-types";
import { listProjectOptions } from "@/server/domain/projects";
import { listRentalHouses } from "@/server/domain/rental-houses";
import { UUID_RE } from "@/server/pages";
import { getT } from "@/server/i18n";
import { ItemCreateForm } from "../item-create-form";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Add equipment") };
}

export default async function NewItemPage({
  searchParams,
}: {
  searchParams: Promise<{ typeId?: string; projectId?: string; rentalHouseId?: string; created?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const t = await getT();
  if (!hasRole(ctx, "member")) return <NoPermission />;
  const db = getDb();
  const [defaultType, rentalHouses, projects, created] = await Promise.all([
    sp.typeId && UUID_RE.test(sp.typeId) ? getEquipmentType(db, ctx, sp.typeId).then((t) => ({ id: t.id, name: t.name, defaultTrackingMode: t.defaultTrackingMode })).catch(() => null) : null,
    listRentalHouses(db, ctx),
    listProjectOptions(db, ctx, { activeOnly: true }),
    sp.created && UUID_RE.test(sp.created) ? getItemDetail(db, ctx, sp.created).catch(() => null) : null,
  ]);
  const [createdBefore, createdAfter] = t("Created {item}. Add the next one:").split("{item}");
  return (
    <>
      <PageHeader
        title={t("Add equipment")}
        subtitle={t("Create one physical item (or a quantity of interchangeable units)")}
        back={sp.projectId ? { href: `/projects/${sp.projectId}`, label: t("Project") } : { href: "/equipment", label: t("Equipment") }}
      />
      {created && (
        <p role="status" className="mb-4 max-w-2xl rounded-lg bg-ok/10 px-3 py-2 text-sm text-ok">
          {createdBefore}
          <Link href={`/equipment/${created.item.id}`} className="font-medium underline">
            {created.label}
          </Link>
          {createdAfter}
        </p>
      )}
      <Card className="max-w-2xl p-5">
        <ItemCreateForm
          key={sp.created ?? "new"}
          defaultType={defaultType}
          rentalHouses={rentalHouses.map((r) => ({ value: r.id, label: r.name }))}
          projects={projects.map((p) => ({ value: p.id, label: p.name }))}
          defaults={{
            projectId: sp.projectId && UUID_RE.test(sp.projectId) ? sp.projectId : undefined,
            rentalHouseId: sp.rentalHouseId && UUID_RE.test(sp.rentalHouseId) ? sp.rentalHouseId : undefined,
          }}
        />
      </Card>
    </>
  );
}
