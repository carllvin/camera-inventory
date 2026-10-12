import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { standardCatalogStatus, standardRentalHouseStatus } from "@/server/domain/standard-catalog";
import { getT } from "@/server/i18n";
import { importCatalogAction, importRentalHousesAction } from "../actions";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Standard catalog") };
}

export default async function CatalogPage() {
  const ctx = await getCtx();
  const [sections, regions] = await Promise.all([standardCatalogStatus(getDb(), ctx), standardRentalHouseStatus(getDb(), ctx)]);
  const isAdmin = hasRole(ctx, "admin");
  const t = await getT();
  const [typesIntro, typesRest = ""] = t(
    "Adds equipment {types} (e.g. “ARRI Signature Prime 35mm T1.8”), not physical items. Every lens focal length is its own type. Types you already have are skipped and never changed; you can edit or archive anything afterwards under {link}.",
  ).split("{types}");
  const [typesMiddle, typesEnd] = typesRest.split("{link}");
  const housesIntro = t(
    "Camera rental houses with the company and branch names printed on their delivery notes, so documents are matched to the right sender. Rental houses you already have are skipped and never changed; manage them under {link}.",
  ).split("{link}");
  const presence = (missing: number, present: number, total: number) =>
    missing === 0 ? t("all {n} present", { n: total }) : present ? t("{n} new · {present} already present", { n: missing, present }) : t("{n} new", { n: missing });
  return (
    <>
      <PageHeader
        title={t("Standard catalog")}
        subtitle={t("Common equipment types and rental houses, with the names used on rental paperwork")}
        back={{ href: "/settings", label: t("Settings") }}
      />
      <Card className="max-w-2xl p-5">
        <h2 className="mb-1 font-semibold">{t("Equipment types")}</h2>
        <p className="mb-4 text-sm text-muted">
          {typesIntro}
          <em>{t("types")}</em>
          {typesMiddle}
          <Link href="/equipment/types" className="text-accent hover:underline">
            {t("Equipment types")}
          </Link>
          {typesEnd}
        </p>
        {isAdmin ? (
          <ActionForm action={importCatalogAction} className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">{t("Areas to import")}</legend>
              {sections.map((sec) => {
                const missing = sec.total - sec.present;
                const todo = missing > 0 || sec.newSpellings > 0;
                return (
                  <label key={sec.key} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-surface-2">
                    <input type="checkbox" name="sections" value={sec.key} defaultChecked={todo} disabled={!todo} className="mt-1 size-4 accent-[var(--accent)]" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                        <span className="font-medium">{t(sec.label)}</span>
                        <span className="text-xs text-muted tabular-nums">
                          {presence(missing, sec.present, sec.total)}
                          {sec.newSpellings > 0 && ` · ${t("new spellings for {n}", { n: sec.newSpellings })}`}
                        </span>
                      </span>
                      <span className="block text-xs text-muted">{t(sec.description)}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            {sections.some((sec) => sec.present < sec.total || sec.newSpellings > 0) ? (
              <SubmitButton pendingText={t("Importing…")}>{t("Import selected areas")}</SubmitButton>
            ) : (
              <p className="text-sm text-muted">{t("Everything from the standard catalog is already in your equipment types.")}</p>
            )}
          </ActionForm>
        ) : (
          <p className="text-sm text-muted">{t("Only admins can import the catalog.")}</p>
        )}
      </Card>
      {regions.length > 0 && (
        <Card className="mt-6 max-w-2xl p-5">
          <h2 className="mb-1 font-semibold">{t("Rental houses")}</h2>
          <p className="mb-4 text-sm text-muted">
            {housesIntro[0]}
            <Link href="/settings/rental-houses" className="text-accent hover:underline">
              {t("Rental houses")}
            </Link>
            {housesIntro[1]}
          </p>
          {isAdmin ? (
            <ActionForm action={importRentalHousesAction} className="space-y-4">
              <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-medium">{t("Regions to import")}</legend>
                {regions.map((r) => {
                  const missing = r.total - r.present;
                  return (
                    <label key={r.key} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-surface-2">
                      <input type="checkbox" name="regions" value={r.key} defaultChecked={missing > 0 && r.key !== "intl"} disabled={missing === 0} className="mt-1 size-4 accent-[var(--accent)]" />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                          <span className="font-medium">{r.label}</span>
                          <span className="text-xs text-muted tabular-nums">
                            {presence(missing, r.present, r.total)}
                          </span>
                        </span>
                        <span className="block text-xs text-muted">{r.description}</span>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
              {regions.some((r) => r.present < r.total) ? (
                <SubmitButton pendingText={t("Importing…")}>{t("Import selected regions")}</SubmitButton>
              ) : (
                <p className="text-sm text-muted">{t("All standard rental houses are already in your list.")}</p>
              )}
            </ActionForm>
          ) : (
            <p className="text-sm text-muted">{t("Only admins can import rental houses.")}</p>
          )}
        </Card>
      )}
    </>
  );
}
