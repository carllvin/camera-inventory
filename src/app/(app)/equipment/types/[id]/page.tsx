import { Pencil, Plus } from "lucide-react";
import { EquipmentTable } from "@/components/equipment-table";
import { ActionForm, SubmitButton } from "@/components/forms";
import { TypeImage } from "@/components/type-image";
import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, KeyValues, LinkButton, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { listItems } from "@/server/domain/equipment-items";
import { getEquipmentType } from "@/server/domain/equipment-types";
import { getPickerDeps } from "@/server/ai/picker-deps";
import { autoPickAction } from "../image-actions";
import { assertUuid, orNotFound } from "@/server/pages";

export default async function TypePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  assertUuid(id);
  const ctx = await getCtx();
  const db = getDb();
  const [t, items] = await Promise.all([orNotFound(getEquipmentType(db, ctx, id)), listItems(db, ctx, { equipmentTypeId: id, limit: 500 })]);
  const primary = t.photos[0];
  const canSearch = Boolean(getPickerDeps().search);
  const canEdit = hasRole(ctx, "member");
  const specs = Object.entries(t.specs ?? {});
  return (
    <>
      <PageHeader
        back={{ href: "/equipment/types", label: "Equipment types" }}
        title={t.name}
        subtitle={t.categoryName ?? "Uncategorized"}
        actions={
          canEdit && (
            <>
              <LinkButton href={`/equipment/new?typeId=${id}`} variant="primary">
                <Plus className="size-4" /> Add item
              </LinkButton>
              <LinkButton href={`/equipment/types/${id}/edit`}>
                <Pencil className="size-4" /> Edit
              </LinkButton>
            </>
          )
        }
      />
      <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-[18rem_1fr]">
        <div className="space-y-2">
          <TypeImage name={t.name} photoId={primary?.id} size="full" />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-muted">
              {primary?.attribution?.startsWith("auto-selected") ? <Badge tone="accent">auto-selected</Badge> : primary?.attribution}
            </span>
            {canEdit && (
              <span className="flex items-center gap-2">
                {!primary && canSearch && (
                  <ActionForm action={autoPickAction.bind(null, id)}>
                    <SubmitButton variant="ghost" className="!px-2 !py-1 text-xs" pendingText="Searching…">
                      Find automatically
                    </SubmitButton>
                  </ActionForm>
                )}
                <Link href={`/equipment/types/${id}/image`} className="font-medium text-accent hover:underline">
                  {primary ? "Change image" : "Choose image"}
                </Link>
              </span>
            )}
          </div>
        </div>
        <Card className="p-4">
          <KeyValues
            items={[
              { label: "Manufacturer", value: t.manufacturer },
              { label: "Model", value: t.model },
              { label: "Tracking", value: t.defaultTrackingMode === "bulk" ? "By quantity" : "Individually (serial numbers)" },
              { label: "Aliases", value: t.aliases.length ? t.aliases.join(", ") : null },
              ...specs.map(([k, v]) => ({ label: k, value: String(v) })),
            ]}
          />
          {t.description && <p className="mt-4 text-sm whitespace-pre-wrap text-muted">{t.description}</p>}
        </Card>
      </div>
      <Card>
        <CardHeader title={`Physical items (${items.length})`} />
        <div className="p-3">
          {items.length === 0 ? <EmptyState title="No items of this type yet" /> : <EquipmentTable items={items} />}
        </div>
      </Card>
    </>
  );
}
