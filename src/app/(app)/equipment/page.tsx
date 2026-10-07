import { Plus } from "lucide-react";
import { EquipmentBrowser, type BrowserParams } from "@/components/equipment-browser";
import { Tabs, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { getCategoryTree } from "@/server/domain/categories";
import { listCases } from "@/server/domain/cases";
import { hasRole } from "@/server/domain/context";
import { listItems, type ItemFilters } from "@/server/domain/equipment-items";
import { listRentalHouses } from "@/server/domain/rental-houses";
import { getCurrentProject } from "@/server/current-project";

export const metadata = { title: "Equipment" };

const LIMIT = 300;

type SP = BrowserParams;

export default async function EquipmentPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const db = getDb();
  // The project chosen in the top bar scopes the list ("All projects" there shows everything).
  const { current } = await getCurrentProject();
  const projectId = current?.id;
  const { view: _view, sort: _sort, ...filterParams } = sp;
  const [items, { flat: categories }, rentalHouses, cases] = await Promise.all([
    listItems(db, ctx, { ...(filterParams as ItemFilters), projectId, limit: LIMIT }),
    getCategoryTree(db, ctx),
    listRentalHouses(db, ctx),
    projectId ? listCases(db, ctx, { projectId }) : Promise.resolve([]),
  ]);
  const hasFilters = Object.values(filterParams).some(Boolean);
  return (
    <>
      <PageHeader
        title={current ? `Equipment · ${current.name}` : "Equipment"}
        subtitle={current ? "Equipment on the project chosen in the top bar" : "Every physical item, across all projects and rental houses"}
        actions={
          hasRole(ctx, "member") && (
            <LinkButton href="/equipment/new" variant="primary">
              <Plus className="size-4" /> Add equipment
            </LinkButton>
          )
        }
      />
      <Tabs
        active="items"
        tabs={[
          { key: "items", href: "/equipment", label: "Items" },
          { key: "types", href: "/equipment/types", label: "Equipment types" },
        ]}
      />
      <EquipmentBrowser
        basePath="/equipment"
        sp={sp}
        items={items}
        limit={LIMIT}
        projectId={projectId}
        categories={categories}
        rentalHouses={rentalHouses}
        cases={cases}
        hasFilters={hasFilters}
        empty={
          <EmptyState title="No equipment yet" action={hasRole(ctx, "member") && <LinkButton href="/equipment/new" variant="primary">Add equipment</LinkButton>} />
        }
      />
    </>
  );
}
