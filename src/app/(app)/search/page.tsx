import Link from "next/link";
import { Box, Briefcase, Building2, Camera, FileText, Tag } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { globalSearch, type SearchHit, type SearchHitKind } from "@/server/domain/search";

export const metadata = { title: "Search" };

const GROUPS: { kind: SearchHitKind; label: string; icon: typeof Camera }[] = [
  { kind: "item", label: "Equipment items", icon: Camera },
  { kind: "type", label: "Equipment types", icon: Tag },
  { kind: "case", label: "Cases", icon: Box },
  { kind: "project", label: "Projects", icon: Briefcase },
  { kind: "rental_house", label: "Rental houses", icon: Building2 },
  { kind: "document", label: "Documents", icon: FileText },
];

function href(h: SearchHit) {
  switch (h.kind) {
    case "item":
      return `/equipment/${h.id}`;
    case "type":
      return `/equipment/types/${h.id}`;
    case "case":
      return `/projects/${h.parentId}/cases`;
    case "project":
      return `/projects/${h.id}`;
    case "rental_house":
      return `/settings/rental-houses/${h.id}`;
    case "document":
      return `/documents/${h.id}`;
  }
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const hits = q.trim().length >= 2 ? await globalSearch(getDb(), await getCtx(), q) : [];
  return (
    <>
      <PageHeader title="Search" subtitle={q ? <>Results for “{q}”</> : "Find equipment, serial numbers, cases, projects, rental houses and documents"} />
      <form action="/search" className="mb-6 sm:hidden">
        <input type="search" name="q" defaultValue={q} placeholder="Search…" className="input" autoFocus />
      </form>
      {q.trim().length < 2 ? (
        <EmptyState title="Type at least two characters">Aliases, serials with or without dashes and small typos all work.</EmptyState>
      ) : hits.length === 0 ? (
        <EmptyState title="Nothing found">Try a serial number, an asset number or part of a model name.</EmptyState>
      ) : (
        <div className="space-y-6">
          {GROUPS.map(({ kind, label, icon: Icon }) => {
            const group = hits.filter((h) => h.kind === kind);
            if (group.length === 0) return null;
            return (
              <section key={kind}>
                <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-muted uppercase">
                  <Icon className="size-3.5" /> {label}
                </h2>
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
                  {group.map((h) => (
                    <li key={h.id}>
                      <Link href={href(h)} className="block px-4 py-2.5 hover:bg-surface-2">
                        <div className="text-sm font-medium">{h.title}</div>
                        {h.subtitle && <div className="text-xs text-muted">{h.subtitle}</div>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
