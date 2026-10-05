import Link from "next/link";
import { Card, NoPermission, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { getItemDetail } from "@/server/domain/equipment-items";
import { listEquipmentTypeOptions } from "@/server/domain/equipment-types";
import { listProjectOptions } from "@/server/domain/projects";
import { listRentalHouses } from "@/server/domain/rental-houses";
import { UUID_RE } from "@/server/pages";
import { ItemCreateForm } from "../item-create-form";

export const metadata = { title: "Add equipment" };

export default async function NewItemPage({
  searchParams,
}: {
  searchParams: Promise<{ typeId?: string; projectId?: string; rentalHouseId?: string; created?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!hasRole(ctx, "member")) return <NoPermission />;
  const db = getDb();
  const [types, rentalHouses, projects, created] = await Promise.all([
    listEquipmentTypeOptions(db, ctx),
    listRentalHouses(db, ctx),
    listProjectOptions(db, ctx, { activeOnly: true }),
    sp.created && UUID_RE.test(sp.created) ? getItemDetail(db, ctx, sp.created).catch(() => null) : null,
  ]);
  return (
    <>
      <PageHeader
        title="Add equipment"
        subtitle="Create one physical item (or a quantity of interchangeable units)"
        back={sp.projectId ? { href: `/projects/${sp.projectId}`, label: "Project" } : { href: "/equipment", label: "Equipment" }}
      />
      {created && (
        <p role="status" className="mb-4 max-w-2xl rounded-lg bg-ok/10 px-3 py-2 text-sm text-ok">
          Created{" "}
          <Link href={`/equipment/${created.item.id}`} className="font-medium underline">
            {created.label}
          </Link>
          . Add the next one:
        </p>
      )}
      <Card className="max-w-2xl p-5">
        <ItemCreateForm
          key={sp.created ?? "new"}
          types={types}
          rentalHouses={rentalHouses.map((r) => ({ value: r.id, label: r.name }))}
          projects={projects.map((p) => ({ value: p.id, label: p.name }))}
          defaults={{
            typeId: sp.typeId && UUID_RE.test(sp.typeId) ? sp.typeId : undefined,
            projectId: sp.projectId && UUID_RE.test(sp.projectId) ? sp.projectId : undefined,
            rentalHouseId: sp.rentalHouseId && UUID_RE.test(sp.rentalHouseId) ? sp.rentalHouseId : undefined,
          }}
        />
      </Card>
    </>
  );
}
