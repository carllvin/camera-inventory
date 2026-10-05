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

export const metadata = { title: "Equipment types" };

export default async function TypesPage({ searchParams }: { searchParams: Promise<{ q?: string; categoryId?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const db = getDb();
  const categoryId = sp.categoryId && UUID_RE.test(sp.categoryId) ? sp.categoryId : null;
  const [types, { flat }] = await Promise.all([listEquipmentTypes(db, ctx, { q: sp.q, categoryId }), getCategoryTree(db, ctx)]);
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
      <FilterBar hasFilters={Boolean(sp.q || categoryId)}>
        <FilterSearch value={sp.q} placeholder="Manufacturer, model, alias…" />
        <FilterSelect name="categoryId" label="Category" allLabel="All categories" value={categoryId}
          options={flat.map((c) => ({ value: c.id, label: `${" ".repeat(c.depth)}${c.name}` }))} />
      </FilterBar>
      {types.length === 0 ? (
        <EmptyState title="No equipment types found" />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {types.map((t) => (
            <li key={t.id}>
              <Link href={`/equipment/types/${t.id}`} className="block h-full overflow-hidden rounded-xl border border-border bg-surface hover:border-ring/60">
                <TypeImage name={t.model} photoId={t.imageId} className="rounded-none" />
                <div className="p-3">
                  <div className="text-xs text-muted">{t.manufacturer}</div>
                  <div className="truncate text-sm font-medium">{t.model}</div>
                  <div className="mt-1 text-xs text-muted">
                    {t.categoryName ?? "Uncategorized"} · {t.itemCount} items{t.onProjectCount > 0 && ` · ${t.onProjectCount} out`}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
