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

const PAGE_SIZE = 60;

export default async function TypesPage({ searchParams }: { searchParams: Promise<{ q?: string; categoryId?: string; use?: string; page?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const db = getDb();
  const categoryId = sp.categoryId && UUID_RE.test(sp.categoryId) ? sp.categoryId : null;
  const inUse = sp.use === "in_use";
  const page = Math.max(1, Math.min(1000, Number.parseInt(sp.page ?? "1", 10) || 1));
  const [rows, { flat }] = await Promise.all([
    listEquipmentTypes(db, ctx, { q: sp.q, categoryId, inUse, limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE }),
    getCategoryTree(db, ctx),
  ]);
  const types = rows.slice(0, PAGE_SIZE);
  const hasNext = rows.length > PAGE_SIZE;
  const pageHref = (n: number) =>
    `/equipment/types?${new URLSearchParams(Object.entries({ q: sp.q ?? "", categoryId: categoryId ?? "", use: inUse ? "in_use" : "", page: n > 1 ? String(n) : "" }).filter(([, v]) => v))}`;
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
