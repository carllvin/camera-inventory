import { CaseList } from "@/components/case-list";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { listCases } from "@/server/domain/cases";

export default async function ProjectCasesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cases = await listCases(getDb(), await getCtx(), { projectId: id });
  return <CaseList cases={cases} />;
}
