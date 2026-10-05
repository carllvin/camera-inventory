import { Pencil, Plus } from "lucide-react";
import { EquipmentTable } from "@/components/equipment-table";
import { PhotoGallery } from "@/components/photo-gallery";
import { TypeImage } from "@/components/type-image";
import { Card, CardHeader, EmptyState, KeyValues, LinkButton, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { listItems } from "@/server/domain/equipment-items";
import { getEquipmentType } from "@/server/domain/equipment-types";
import { listPhotos } from "@/server/domain/photos";
import { assertUuid, orNotFound } from "@/server/pages";

export default async function TypePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  assertUuid(id);
  const ctx = await getCtx();
  const db = getDb();
  const [t, items, photos] = await Promise.all([
    orNotFound(getEquipmentType(db, ctx, id)),
    listItems(db, ctx, { equipmentTypeId: id, limit: 500 }),
    listPhotos(db, ctx, { equipmentTypeId: id }),
  ]);
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
        <TypeImage name={t.name} photoId={t.photos[0]?.id} size="full" />
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
      <div className="mb-6">
        <PhotoGallery photos={photos} target={{ kind: "type", id }} canEdit={canEdit} title="Reference images" />
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
