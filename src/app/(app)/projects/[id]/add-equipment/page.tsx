import { Plus } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { FilterBar, FilterSearch } from "@/components/filters";
import { Card, CardHeader, EmptyState, LinkButton, Mono, NoPermission, StatusBadge } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { listItems } from "@/server/domain/equipment-items";
import { addItemToProjectAction } from "../../actions";

export default async function AddEquipmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string }> }) {
  const [{ id }, { q }] = await Promise.all([params, searchParams]);
  const ctx = await getCtx();
  if (!hasRole(ctx, "member")) return <NoPermission />;
  const items = await listItems(getDb(), ctx, { location: "off_project", q, limit: 100 });
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
      <Card className="self-start p-4 lg:order-last">
        <p className="mb-3 text-sm text-muted">Equipment that is not in the database yet:</p>
        <LinkButton href={`/equipment/new?projectId=${id}`} variant="primary" className="w-full">
          <Plus className="size-4" /> Create new item
        </LinkButton>
      </Card>
      <Card>
        <CardHeader title="Add equipment from the database" />
        <div className="p-4 pb-0">
          <FilterBar hasFilters={Boolean(q)}>
            <FilterSearch value={q} placeholder="Search returned / available equipment…" />
          </FilterBar>
        </div>
        {items.length === 0 ? (
          <div className="p-4">
            <EmptyState title={q ? "Nothing found" : "No equipment available"}>
              Only equipment that is not on a project can be added. Items on another project must be returned or removed there first.
            </EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{i.typeName}</div>
                  <div className="text-xs text-muted">
                    <Mono>{[i.serialNumber && `SN ${i.serialNumber}`, i.assetNumber && `Asset ${i.assetNumber}`, i.trackingMode === "bulk" && `Qty ${i.quantity}`].filter(Boolean).join(" · ") || "No serial"}</Mono>
                    {" · "}
                    {i.rentalHouseName ?? "Owned"}
                  </div>
                </div>
                <StatusBadge status={i.status} />
                <ActionForm action={addItemToProjectAction.bind(null, id, i.id)}>
                  <SubmitButton variant="secondary" pendingText="Adding…">
                    Add
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
