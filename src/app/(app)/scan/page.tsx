import Link from "next/link";
import { Plus } from "lucide-react";
import { Card, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { hasRole } from "@/server/domain/context";
import { Scanner } from "./scanner";

export const metadata = { title: "Scan" };

export default async function ScanPage() {
  const ctx = await getCtx();
  return (
    <>
      <PageHeader title="Scan" subtitle="Open equipment or a case by its QR code, barcode, serial or asset number" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,32rem)_1fr]">
        <Card className="p-4">
          <Scanner />
        </Card>
        {hasRole(ctx, "member") && (
          <div className="space-y-3">
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
