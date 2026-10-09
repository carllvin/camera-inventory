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

export default async function TypePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  assertUuid(id);
  const ctx = await getCtx();
  const db = getDb();
  const [t, items] = await Promise.all([orNotFound(getEquipmentType(db, ctx, id)), listItems(db, ctx, { equipmentTypeId: id, limit: 500 })]);
  const primary = t.photos[0];
  const canSearch = Boolean(getPickerDeps().search);
  const deleted = Boolean(t.archivedAt);
  const canEdit = hasRole(ctx, "member") && !deleted;
  const onProject = items.filter((i) => i.projectId).reduce((n, i) => n + i.quantity, 0);
  const specs = Object.entries(t.specs ?? {});
  return (
    <>
      <PageHeader
        back={{ href: "/equipment/types", label: "Equipment types" }}
        title={
          <span className="flex items-center gap-2">
            <span className="truncate">{t.name}</span>
            {deleted && <Badge>Deleted</Badge>}
          </span>
        }
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
      {deleted && hasRole(ctx, "member") && (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <span className="text-muted">This type was deleted: it no longer shows up in lists, pickers or document matching.</span>
          <ActionForm action={restoreTypeAction.bind(null, id)}>
            <SubmitButton variant="secondary" pendingText="…">
              Restore type
            </SubmitButton>
          </ActionForm>
        </Card>
      )}
      <Card>
        <CardHeader title={`Physical items (${items.length})`} />
        <div className="p-3">
          {items.length === 0 ? <EmptyState title="No items of this type yet" /> : <EquipmentTable items={items} />}
        </div>
      </Card>
      {canEdit && (
        <details className="mt-6 text-sm">
          <summary className="cursor-pointer text-muted">Delete this type…</summary>
          <div className="mt-2 space-y-3 rounded-xl border border-border bg-surface p-4">
            {onProject > 0 ? (
              <p className="text-warn">
                {onProject} piece{onProject === 1 ? " is" : "s are"} on a project. Remove {onProject === 1 ? "it" : "them"} from the project first.
              </p>
            ) : (
              <>
                <p className="text-muted">
                  The type disappears from lists, pickers and document matching, and the standard catalog won&apos;t bring it back.
                  {items.length > 0 && " Past pieces keep it, with their history."} You can undo this in the history.
                </p>
                <ActionForm action={deleteTypesAction}>
                  <input type="hidden" name="typeId" value={id} />
                  <input type="hidden" name="from" value="type" />
                  <SubmitButton variant="danger" pendingText="Deleting…">
                    Delete {t.name}
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
