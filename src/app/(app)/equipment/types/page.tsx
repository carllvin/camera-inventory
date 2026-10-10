import Link from "next/link";
import { Plus } from "lucide-react";
import { FilterBar, FilterSearch, FilterSelect } from "@/components/filters";
import { TypeImage } from "@/components/type-image";
import { EmptyState, LinkButton, PageHeader, Tabs } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { getCategoryTree } from "@/server/domain/categories";
import { hasRole } from "@/server/domain/context";
import { listEquipmentTypes } from "@/server/domain/equipment-types";
import { UUID_RE } from "@/server/pages";
import { ActionForm } from "@/components/forms";
import { DeleteTypesBar } from "@/components/select-tools";
import { getT } from "@/server/i18n";
import { deleteTypesAction } from "../actions";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Equipment types") };
}

const PAGE_SIZE = 60;

export default async function TypesPage({ searchParams }: { searchParams: Promise<{ q?: string; categoryId?: string; use?: string; page?: string; select?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const t = await getT();
  const db = getDb();
  const categoryId = sp.categoryId && UUID_RE.test(sp.categoryId) ? sp.categoryId : null;
  const inUse = sp.use === "in_use";
  const canEdit = hasRole(ctx, "member");
  const selecting = canEdit && sp.select === "1";
  const page = Math.max(1, Math.min(1000, Number.parseInt(sp.page ?? "1", 10) || 1));
  const [rows, { flat }] = await Promise.all([
    listEquipmentTypes(db, ctx, { q: sp.q, categoryId, inUse, limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE }),
    getCategoryTree(db, ctx),
  ]);
  const types = rows.slice(0, PAGE_SIZE);
  const hasNext = rows.length > PAGE_SIZE;
  const pageHref = (n: number) =>
    `/equipment/types?${new URLSearchParams(Object.entries({ q: sp.q ?? "", categoryId: categoryId ?? "", use: inUse ? "in_use" : "", page: n > 1 ? String(n) : "", select: selecting ? "1" : "" }).filter(([, v]) => v))}`;
  const selectHref = (on: boolean) =>
    `/equipment/types?${new URLSearchParams(Object.entries({ q: sp.q ?? "", categoryId: categoryId ?? "", use: inUse ? "in_use" : "", page: page > 1 ? String(page) : "", select: on ? "1" : "" }).filter(([, v]) => v))}`;
  const cards = (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {types.map((et) => {
        const body = (
          <>
            <TypeImage name={et.model} photoId={et.imageId} className="rounded-none" />
            <div className="p-3">
              <div className="text-xs text-muted">{et.manufacturer}</div>
              <div className="truncate text-sm font-medium">{et.model}</div>
              <div className="mt-1 text-xs text-muted">
                {et.categoryName ?? t("Uncategorized")} · {t("{n} items", { n: et.itemCount })}{et.onProjectCount > 0 && ` · ${t("{n} out", { n: et.onProjectCount })}`}
              </div>
            </div>
          </>
        );
        return (
          <li key={et.id}>
            {selecting ? (
              <label className="relative block h-full cursor-pointer overflow-hidden rounded-xl border border-border bg-surface has-[:checked]:border-danger has-[:checked]:ring-2 has-[:checked]:ring-danger/30">
                <input
                  type="checkbox"
                  name="typeId"
                  value={et.id}
                  aria-label={t("Select {name}", { name: et.name })}
                  disabled={et.onProjectCount > 0}
                  className="absolute top-2 left-2 z-10 size-5"
                />
                {body}
                {et.onProjectCount > 0 && <div className="px-3 pb-2 text-xs text-warn">{t("On a project, can't be deleted")}</div>}
              </label>
            ) : (
              <Link href={`/equipment/types/${et.id}`} className="block h-full overflow-hidden rounded-xl border border-border bg-surface hover:border-ring/60">
                {body}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
  return (
    <>
      <PageHeader
        title={t("Equipment")}
        subtitle={t("Models and products — each can have many physical items")}
        actions={
          hasRole(ctx, "member") && (
            <LinkButton href="/equipment/types/new" variant="primary">
              <Plus className="size-4" /> {t("New type")}
            </LinkButton>
          )
        }
      />
      <Tabs
        active="types"
        tabs={[
          { key: "items", href: "/equipment", label: t("Items") },
          { key: "types", href: "/equipment/types", label: t("Equipment types") },
        ]}
      />
      <FilterBar hasFilters={Boolean(sp.q || categoryId || inUse)}>
        <FilterSearch value={sp.q} placeholder={t("Manufacturer, model, alias…")} />
        <FilterSelect name="categoryId" label={t("Category")} allLabel={t("All categories")} value={categoryId}
          options={flat.map((c) => ({ value: c.id, label: `${" ".repeat(c.depth)}${c.name}` }))} />
        <FilterSelect name="use" label={t("Items")} allLabel={t("All types")} value={inUse ? "in_use" : null} options={[{ value: "in_use", label: t("With items only") }]} />
      </FilterBar>
      {canEdit && types.length > 0 && (
        <div className="mb-3 flex justify-end">
          <Link href={selectHref(!selecting)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-2">
            {selecting ? t("Done") : t("Select to delete")}
          </Link>
        </div>
      )}
      {selecting ? (
        // The form stays when the list empties, so its "… deleted" message is still shown.
        <ActionForm action={deleteTypesAction}>
          {types.length === 0 ? <EmptyState title={t("No equipment types found")} /> : cards}
          {types.length > 0 && <DeleteTypesBar />}
        </ActionForm>
      ) : types.length === 0 ? (
        <EmptyState title={t("No equipment types found")} />
      ) : (
        cards
      )}
      {(page > 1 || hasNext) && (
        <nav className="mt-6 flex items-center justify-between text-sm" aria-label={t("Pages")}>
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="text-accent hover:underline">
              {t("← Previous")}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">{t("Page {n}", { n: page })}</span>
          {hasNext ? (
            <Link href={pageHref(page + 1)} className="text-accent hover:underline">
              {t("Next →")}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}
