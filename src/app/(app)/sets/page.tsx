import { Plus } from "lucide-react";
import { CaseList } from "@/components/case-list";
import { LinkButton, PageHeader, Tabs } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { listCases } from "@/server/domain/cases";
import { getCurrentProject } from "@/server/current-project";
import { hasRole } from "@/server/domain/context";

export const metadata = { title: "Sets" };

export default async function CasesPage() {
  const ctx = await getCtx();
  const { current } = await getCurrentProject();
  const cases = await listCases(getDb(), ctx, { projectId: current?.id });
  const canEdit = hasRole(ctx, "member");
  return (
    <>
      <PageHeader
        title="Sets"
        subtitle={current ? `Sets of ${current.name}` : "Expected vs. packed contents across all projects"}
        actions={canEdit && <LinkButton href="/sets/new" variant="primary"><Plus className="size-4" /> New set</LinkButton>}
      />
      <Tabs active="cases" tabs={[{ key: "cases", href: "/sets", label: "Sets" }, { key: "templates", href: "/sets/templates", label: "Templates" }]} />
      <CaseList cases={cases} showProject={!current} emptyAction={canEdit && <LinkButton href="/sets/new" variant="primary">New set</LinkButton>} />
    </>
  );
}
