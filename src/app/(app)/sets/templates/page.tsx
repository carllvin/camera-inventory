import Link from "next/link";
import { Plus } from "lucide-react";
import { EmptyState, LinkButton, PageHeader, Tabs } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { listTemplates } from "@/server/domain/cases";
import { hasRole } from "@/server/domain/context";
import { getT } from "@/server/i18n";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Set templates") };
}

export default async function TemplatesPage() {
  const ctx = await getCtx();
  const templates = await listTemplates(getDb(), ctx);
  const canEdit = hasRole(ctx, "member");
  const t = await getT();
  return (
    <>
      <PageHeader
        title={t("Sets")}
        subtitle={t("Templates are reusable packing lists for any project")}
        actions={canEdit && <LinkButton href="/sets/templates/new" variant="primary"><Plus className="size-4" /> {t("New template")}</LinkButton>}
      />
      <Tabs active="templates" tabs={[{ key: "cases", href: "/sets", label: t("Sets") }, { key: "templates", href: "/sets/templates", label: t("Templates") }]} />
      {templates.length === 0 ? (
        <EmptyState title={t("No templates yet")}>{t("Create one here, or save an existing set as a template.")}</EmptyState>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {templates.map((tpl) => (
            <li key={tpl.id}>
              <Link href={`/sets/templates/${tpl.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{tpl.name}</div>
                  {tpl.description && <div className="truncate text-xs text-muted">{tpl.description}</div>}
                </div>
                <div className="text-right text-xs text-muted tabular-nums">
                  <div>
                    <span className="font-medium text-text">{tpl.unitCount}</span> {t("items · {n} lines", { n: tpl.lineCount })}
                  </div>
                  <div>{tpl.caseCount === 1 ? t("used by 1 case") : t("used by {n} cases", { n: tpl.caseCount })}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
