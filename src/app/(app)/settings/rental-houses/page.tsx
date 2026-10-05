import Link from "next/link";
import { Plus } from "lucide-react";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { listRentalHouses } from "@/server/domain/rental-houses";

export const metadata = { title: "Rental houses" };

export default async function RentalHousesPage() {
  const ctx = await getCtx();
  const houses = await listRentalHouses(getDb(), ctx);
  return (
    <>
      <PageHeader
        title="Rental houses"
        back={{ href: "/settings", label: "Settings" }}
        actions={hasRole(ctx, "member") && <LinkButton href="/settings/rental-houses/new" variant="primary"><Plus className="size-4" /> New rental house</LinkButton>}
      />
      {houses.length === 0 ? (
        <EmptyState title="No rental houses yet" />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {houses.map((h) => (
            <li key={h.id}>
              <Link href={`/settings/rental-houses/${h.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{h.name}</div>
                  <div className="truncate text-xs text-muted">{[h.shortName, h.phone, h.aliases.join(", ")].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="text-right text-xs text-muted tabular-nums">
                  <div><span className="font-medium text-text">{h.onProjects}</span> items out</div>
                  <div>{h.projectCount} projects</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
