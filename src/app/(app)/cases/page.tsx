import { Plus } from "lucide-react";
import { CaseList } from "@/components/case-list";
import { LinkButton, PageHeader, Tabs } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { listCases } from "@/server/domain/cases";
import { hasRole } from "@/server/domain/context";

export const metadata = { title: "Cases" };

export default async function CasesPage() {
  const ctx = await getCtx();
  const cases = await listCases(getDb(), ctx);
  const canEdit = hasRole(ctx, "member");
  return (
    <>
      <PageHeader
        title="Cases"
        subtitle="Expected vs. packed contents across all projects"
        actions={canEdit && <LinkButton href="/cases/new" variant="primary"><Plus className="size-4" /> New case</LinkButton>}
      />
      <Tabs active="cases" tabs={[{ key: "cases", href: "/cases", label: "Cases" }, { key: "templates", href: "/cases/templates", label: "Templates" }]} />
      <CaseList cases={cases} showProject emptyAction={canEdit && <LinkButton href="/cases/new" variant="primary">New case</LinkButton>} />
    </>
  );
}
