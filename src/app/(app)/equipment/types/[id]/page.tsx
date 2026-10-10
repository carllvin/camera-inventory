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
import { deleteTypesAction, restoreTypeAction } from "../../actions";
import { assertUuid, orNotFound } from "@/server/pages";
import { getT } from "@/server/i18n";

export default async function TypePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  assertUuid(id);
  const ctx = await getCtx();
  const t = await getT();
  const db = getDb();
  const [et, items] = await Promise.all([orNotFound(getEquipmentType(db, ctx, id)), listItems(db, ctx, { equipmentTypeId: id, limit: 500 })]);
  const primary = et.photos[0];
  const canSearch = Boolean(getPickerDeps().search);
  const deleted = Boolean(et.archivedAt);
  const canEdit = hasRole(ctx, "member") && !deleted;
  const onProject = items.filter((i) => i.projectId).reduce((n, i) => n + i.quantity, 0);
  const specs = Object.entries(et.specs ?? {});
  return (
    <>
      <PageHeader
        back={{ href: "/equipment/types", label: t("Equipment types") }}
        title={
          <span className="flex items-center gap-2">
            <span className="truncate">{et.name}</span>
            {deleted && <Badge>{t("Deleted")}</Badge>}
          </span>
        }
        subtitle={et.categoryName ?? t("Uncategorized")}
        actions={
          canEdit && (
            <>
              <LinkButton href={`/equipment/new?typeId=${id}`} variant="primary">
                <Plus className="size-4" /> {t("Add item")}
              </LinkButton>
              <LinkButton href={`/equipment/types/${id}/edit`}>
                <Pencil className="size-4" /> {t("Edit")}
              </LinkButton>
            </>
          )
        }
      />
      <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-[18rem_1fr]">
        <div className="space-y-2">
          <TypeImage name={et.name} photoId={primary?.id} size="full" />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-muted">
              {primary?.attribution?.startsWith("auto-selected") ? <Badge tone="accent">{t("auto-selected")}</Badge> : primary?.attribution}
            </span>
            {canEdit && (
              <span className="flex items-center gap-2">
                {!primary && canSearch && (
                  <ActionForm action={autoPickAction.bind(null, id)}>
                    <SubmitButton variant="ghost" className="!px-2 !py-1 text-xs" pendingText={t("Searching…")}>
                      {t("Find automatically")}
                    </SubmitButton>
                  </ActionForm>
                )}
                <Link href={`/equipment/types/${id}/image`} className="font-medium text-accent hover:underline">
                  {primary ? t("Change image") : t("Choose image")}
                </Link>
              </span>
            )}
          </div>
        </div>
        <Card className="p-4">
          <KeyValues
            items={[
              { label: t("Manufacturer"), value: et.manufacturer },
              { label: t("Model"), value: et.model },
              { label: t("Tracking"), value: et.defaultTrackingMode === "bulk" ? t("By quantity") : t("Individually (serial numbers)") },
              { label: t("Aliases"), value: et.aliases.length ? et.aliases.join(", ") : null },
              ...specs.map(([k, v]) => ({ label: k, value: String(v) })),
            ]}
          />
          {et.description && <p className="mt-4 text-sm whitespace-pre-wrap text-muted">{et.description}</p>}
        </Card>
      </div>
      {deleted && hasRole(ctx, "member") && (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <span className="text-muted">{t("This type was deleted: it no longer shows up in lists, pickers or document matching.")}</span>
          <ActionForm action={restoreTypeAction.bind(null, id)}>
            <SubmitButton variant="secondary" pendingText="…">
              {t("Restore type")}
            </SubmitButton>
          </ActionForm>
        </Card>
      )}
      <Card>
        <CardHeader title={t("Physical items ({n})", { n: items.length })} />
        <div className="p-3">
          {items.length === 0 ? <EmptyState title={t("No items of this type yet")} /> : <EquipmentTable items={items} />}
        </div>
      </Card>
      {canEdit && (
        <details className="mt-6 text-sm">
          <summary className="cursor-pointer text-muted">{t("Delete this type…")}</summary>
          <div className="mt-2 space-y-3 rounded-xl border border-border bg-surface p-4">
            {onProject > 0 ? (
              <p className="text-warn">
                {onProject === 1 ? t("1 piece is on a project. Remove it from the project first.") : t("{n} pieces are on a project. Remove them from the project first.", { n: onProject })}
              </p>
            ) : (
              <>
                <p className="text-muted">
                  {t("The type disappears from lists, pickers and document matching, and the standard catalog won't bring it back.")}
                  {items.length > 0 && ` ${t("Past pieces keep it, with their history.")}`} {t("You can undo this in the history.")}
                </p>
                <ActionForm action={deleteTypesAction}>
                  <input type="hidden" name="typeId" value={id} />
                  <input type="hidden" name="from" value="type" />
                  <SubmitButton variant="danger" pendingText={t("Deleting…")}>
                    {t("Delete {name}", { name: et.name })}
                  </SubmitButton>
                </ActionForm>
              </>
            )}
          </div>
        </details>
      )}
    </>
  );
}
