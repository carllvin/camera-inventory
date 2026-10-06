import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { standardCatalogStatus } from "@/server/domain/standard-catalog";
import { importCatalogAction } from "../actions";

export const metadata = { title: "Standard equipment catalog" };

export default async function CatalogPage() {
  const ctx = await getCtx();
  const sections = await standardCatalogStatus(getDb(), ctx);
  const isAdmin = hasRole(ctx, "admin");
  return (
    <>
      <PageHeader
        title="Standard equipment catalog"
        subtitle="Common camera-department equipment types with the names rental houses use on their paperwork"
        back={{ href: "/settings", label: "Settings" }}
      />
      <Card className="max-w-2xl p-5">
        <p className="mb-4 text-sm text-muted">
          Adds equipment <em>types</em> (e.g. “ARRI Signature Prime 35mm T1.8”), not physical items. Every lens focal length is its own type. Types you
          already have are skipped and never changed; you can edit or archive anything afterwards under{" "}
          <Link href="/equipment/types" className="text-accent hover:underline">
            Equipment types
          </Link>
          .
        </p>
        {isAdmin ? (
          <ActionForm action={importCatalogAction} className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">Areas to import</legend>
              {sections.map((sec) => {
                const missing = sec.total - sec.present;
                return (
                  <label key={sec.key} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-surface-2">
                    <input type="checkbox" name="sections" value={sec.key} defaultChecked={missing > 0} disabled={missing === 0} className="mt-1 size-4 accent-[var(--accent)]" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                        <span className="font-medium">{sec.label}</span>
                        <span className="text-xs text-muted tabular-nums">
                          {missing === 0 ? `all ${sec.total} present` : `${missing} new${sec.present ? ` · ${sec.present} already present` : ""}`}
                        </span>
                      </span>
                      <span className="block text-xs text-muted">{sec.description}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            {sections.some((sec) => sec.present < sec.total) ? (
              <SubmitButton pendingText="Importing…">Import selected areas</SubmitButton>
            ) : (
              <p className="text-sm text-muted">Everything from the standard catalog is already in your equipment types.</p>
            )}
          </ActionForm>
        ) : (
          <p className="text-sm text-muted">Only admins can import the catalog.</p>
        )}
      </Card>
    </>
  );
}
