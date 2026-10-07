import { Plus } from "lucide-react";
import { CaseList } from "@/components/case-list";
import { LinkButton } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { listCases } from "@/server/domain/cases";
import { hasRole } from "@/server/domain/context";

export default async function ProjectCasesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  const cases = await listCases(getDb(), ctx, { projectId: id });
  const newCase = hasRole(ctx, "member") && (
    <LinkButton href={`/sets/new?projectId=${id}`} variant="primary">
      <Plus className="size-4" /> New case
    </LinkButton>
  );
  return (
    <>
      {cases.length > 0 && newCase && <div className="mb-3 flex justify-end">{newCase}</div>}
      <CaseList cases={cases} emptyAction={newCase} />
    </>
  );
}
