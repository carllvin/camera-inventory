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
import { deleteTypesAction } from "../actions";

export const metadata = { title: "Equipment types" };

const PAGE_SIZE = 60;

export default async function TypesPage({ searchParams }: { searchParams: Promise<{ q?: string; categoryId?: string; use?: string; page?: string; select?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
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
      {types.map((t) => {
        const body = (
          <>
            <TypeImage name={t.model} photoId={t.imageId} className="rounded-none" />
            <div className="p-3">
              <div className="text-xs text-muted">{t.manufacturer}</div>
              <div className="truncate text-sm font-medium">{t.model}</div>
              <div className="mt-1 text-xs text-muted">
                {t.categoryName ?? "Uncategorized"} · {t.itemCount} items{t.onProjectCount > 0 && ` · ${t.onProjectCount} out`}
              </div>
            </div>
          </>
        );
        return (
          <li key={t.id}>
            {selecting ? (
              <label className="relative block h-full cursor-pointer overflow-hidden rounded-xl border border-border bg-surface has-[:checked]:border-danger has-[:checked]:ring-2 has-[:checked]:ring-danger/30">
                <input
                  type="checkbox"
                  name="typeId"
                  value={t.id}
                  aria-label={`Select ${t.name}`}
                  disabled={t.onProjectCount > 0}
                  className="absolute top-2 left-2 z-10 size-5"
                />
                {body}
                {t.onProjectCount > 0 && <div className="px-3 pb-2 text-xs text-warn">On a project, can&apos;t be deleted</div>}
              </label>
            ) : (
              <Link href={`/equipment/types/${t.id}`} className="block h-full overflow-hidden rounded-xl border border-border bg-surface hover:border-ring/60">
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
        title="Equipment"
        subtitle="Models and products — each can have many physical items"
        actions={
          hasRole(ctx, "member") && (
            <LinkButton href="/equipment/types/new" variant="primary">
              <Plus className="size-4" /> New type
            </LinkButton>
          )
        }
      />
      <Tabs
        active="types"
        tabs={[
          { key: "items", href: "/equipment", label: "Items" },
          { key: "types", href: "/equipment/types", label: "Equipment types" },
        ]}
      />
      <FilterBar hasFilters={Boolean(sp.q || categoryId || inUse)}>
        <FilterSearch value={sp.q} placeholder="Manufacturer, model, alias…" />
        <FilterSelect name="categoryId" label="Category" allLabel="All categories" value={categoryId}
          options={flat.map((c) => ({ value: c.id, label: `${" ".repeat(c.depth)}${c.name}` }))} />
        <FilterSelect name="use" label="Items" allLabel="All types" value={inUse ? "in_use" : null} options={[{ value: "in_use", label: "With items only" }]} />
      </FilterBar>
      {canEdit && types.length > 0 && (
        <div className="mb-3 flex justify-end">
          <Link href={selectHref(!selecting)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-2">
            {selecting ? "Done" : "Select to delete"}
          </Link>
        </div>
      )}
      {selecting ? (
        // The form stays when the list empties, so its "… deleted" message is still shown.
        <ActionForm action={deleteTypesAction}>
          {types.length === 0 ? <EmptyState title="No equipment types found" /> : cards}
          {types.length > 0 && <DeleteTypesBar />}
        </ActionForm>
      ) : types.length === 0 ? (
        <EmptyState title="No equipment types found" />
      ) : (
        cards
      )}
      {(page > 1 || hasNext) && (
        <nav className="mt-6 flex items-center justify-between text-sm" aria-label="Pages">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="text-accent hover:underline">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">Page {page}</span>
          {hasNext ? (
            <Link href={pageHref(page + 1)} className="text-accent hover:underline">
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}
