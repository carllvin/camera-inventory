import Link from "next/link";
import { Plus } from "lucide-react";
import { EmptyState, LinkButton, PageHeader, Tabs } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { listTemplates } from "@/server/domain/cases";
import { hasRole } from "@/server/domain/context";

export const metadata = { title: "Case templates" };

export default async function TemplatesPage() {
  const ctx = await getCtx();
  const templates = await listTemplates(getDb(), ctx);
  const canEdit = hasRole(ctx, "member");
  return (
    <>
      <PageHeader
        title="Cases"
        subtitle="Templates are reusable packing lists for any project"
        actions={canEdit && <LinkButton href="/cases/templates/new" variant="primary"><Plus className="size-4" /> New template</LinkButton>}
      />
      <Tabs active="templates" tabs={[{ key: "cases", href: "/cases", label: "Cases" }, { key: "templates", href: "/cases/templates", label: "Templates" }]} />
      {templates.length === 0 ? (
        <EmptyState title="No templates yet">Create one here, or save an existing case as a template.</EmptyState>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {templates.map((t) => (
            <li key={t.id}>
              <Link href={`/cases/templates/${t.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{t.name}</div>
                  {t.description && <div className="truncate text-xs text-muted">{t.description}</div>}
                </div>
                <div className="text-right text-xs text-muted tabular-nums">
                  <div>
                    <span className="font-medium text-text">{t.unitCount}</span> items · {t.lineCount} lines
                  </div>
                  <div>used by {t.caseCount} case{t.caseCount === 1 ? "" : "s"}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
