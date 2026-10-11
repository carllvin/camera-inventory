import Link from "next/link";
import { FileDown, FileUp, Plus, ListChecks } from "lucide-react";
import { Card, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { hasRole } from "@/server/domain/context";
import { getT } from "@/server/i18n";
import { Scanner } from "./scanner";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Scan") };
}

export default async function ScanPage() {
  const ctx = await getCtx();
  const t = await getT();
  return (
    <>
      <PageHeader title={t("Scan")} subtitle={t("Open equipment or a set by its QR code, barcode, serial or asset number")} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,32rem)_1fr]">
        <Card className="p-4">
          <Scanner />
        </Card>
        {hasRole(ctx, "member") && (
          <div className="space-y-3">
            <Link href="/documents/new" className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 hover:border-ring/60">
              <FileUp className="size-5 text-accent" />
              <div>
                <div className="font-medium">{t("Delivery note")}</div>
                <div className="text-xs text-muted">{t("Photograph or upload a rental house’s delivery note and receive the equipment")}</div>
              </div>
            </Link>
            <Link href="/documents/new?kind=return_note" className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 hover:border-ring/60">
              <FileDown className="size-5 text-accent" />
              <div>
                <div className="font-medium">{t("Return note")}</div>
                <div className="text-xs text-muted">{t("Return equipment to a rental house — full or partial")}</div>
              </div>
            </Link>
            <Link href="/documents/new?kind=inventory_list" className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 hover:border-ring/60">
              <ListChecks className="size-5 text-accent" />
              <div>
                <div className="font-medium">{t("Current list")}</div>
                <div className="text-xs text-muted">{t("Compare the rental house’s list of everything you have with the database — add or remove differences")}</div>
              </div>
            </Link>
            <Link href="/equipment/new" className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 hover:border-ring/60">
              <Plus className="size-5 text-accent" />
              <div>
                <div className="font-medium">{t("Add equipment manually")}</div>
                <div className="text-xs text-muted">{t("Create an item with serial, asset number and owner")}</div>
              </div>
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
