import { CaseList } from "@/components/case-list";
import { PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { listCases } from "@/server/domain/cases";

export const metadata = { title: "Cases" };

export default async function CasesPage() {
  const cases = await listCases(getDb(), await getCtx());
  return (
    <>
      <PageHeader title="Cases" subtitle="Expected vs. actual contents across all projects" />
      <CaseList cases={cases} showProject />
    </>
  );
}
