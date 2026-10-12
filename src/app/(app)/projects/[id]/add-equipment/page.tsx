import { Plus } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { FilterBar, FilterSearch } from "@/components/filters";
import { Card, CardHeader, EmptyState, LinkButton, Mono, NoPermission, StatusBadge } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { listItems } from "@/server/domain/equipment-items";
import { getT, getTN } from "@/server/i18n";
import { addItemToProjectAction } from "../../actions";

export default async function AddEquipmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string }> }) {
  const [{ id }, { q }] = await Promise.all([params, searchParams]);
  const ctx = await getCtx();
  if (!hasRole(ctx, "member")) return <NoPermission />;
  const items = await listItems(getDb(), ctx, { location: "off_project", q, limit: 100 });
  const [t, tn] = await Promise.all([getT(), getTN()]);
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_18rem]">
      <Card className="self-start p-4 lg:order-last">
        <p className="mb-3 text-sm text-muted">{t("Equipment that is not in the database yet:")}</p>
        <LinkButton href={`/equipment/new?projectId=${id}`} variant="primary" className="w-full">
          <Plus className="size-4" /> {t("Create new item")}
        </LinkButton>
      </Card>
      <Card>
        <CardHeader title={t("Add equipment from the database")} />
        <div className="p-4 pb-0">
          <FilterBar hasFilters={Boolean(q)}>
            <FilterSearch value={q} placeholder={t("Search returned / available equipment…")} />
          </FilterBar>
        </div>
        {items.length === 0 ? (
          <div className="p-4">
            <EmptyState title={q ? t("Nothing found") : t("No equipment available")}>
              {t("Only equipment that is not on a project can be added. Items on another project must be returned or removed there first.")}
            </EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{tn(i.typeName)}</div>
                  <div className="text-xs text-muted">
                    <Mono>{[i.serialNumber && t("SN {sn}", { sn: i.serialNumber }), i.assetNumber && t("Asset {n}", { n: i.assetNumber }), i.trackingMode === "bulk" && t("Qty {n}", { n: i.quantity })].filter(Boolean).join(" · ") || t("No serial")}</Mono>
                    {" · "}
                    {i.rentalHouseName ?? t("Owned")}
                  </div>
                </div>
                <StatusBadge status={i.status} />
                <ActionForm action={addItemToProjectAction.bind(null, id, i.id)}>
                  <SubmitButton variant="secondary" pendingText={t("Adding…")}>
                    {t("Add")}
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
