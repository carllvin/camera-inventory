import Link from "next/link";
import { FileDown, FileUp, Plus, ListChecks } from "lucide-react";
import { Card, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { hasRole } from "@/server/domain/context";
import { Scanner } from "./scanner";

export const metadata = { title: "Scan" };

export default async function ScanPage() {
  const ctx = await getCtx();
  return (
    <>
      <PageHeader title="Scan" subtitle="Open equipment or a set by its QR code, barcode, serial or asset number" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,32rem)_1fr]">
        <Card className="p-4">
          <Scanner />
        </Card>
        {hasRole(ctx, "member") && (
          <div className="space-y-3">
            <Link href="/documents/new" className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 hover:border-ring/60">
              <FileUp className="size-5 text-accent" />
              <div>
                <div className="font-medium">Delivery note</div>
                <div className="text-xs text-muted">Photograph or upload a rental house’s delivery note and receive the equipment</div>
              </div>
            </Link>
            <Link href="/documents/new?kind=return_note" className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 hover:border-ring/60">
              <FileDown className="size-5 text-accent" />
              <div>
                <div className="font-medium">Return note</div>
                <div className="text-xs text-muted">Return equipment to a rental house — full or partial</div>
              </div>
            </Link>
            <Link href="/documents/new?kind=inventory_list" className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 hover:border-ring/60">
              <ListChecks className="size-5 text-accent" />
              <div>
                <div className="font-medium">Current list</div>
                <div className="text-xs text-muted">Compare the rental house’s list of everything you have with the database — add or remove differences</div>
              </div>
            </Link>
            <Link href="/equipment/new" className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 hover:border-ring/60">
              <Plus className="size-5 text-accent" />
              <div>
                <div className="font-medium">Add equipment manually</div>
                <div className="text-xs text-muted">Create an item with serial, asset number and owner</div>
              </div>
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
