import { ActionForm, Select, SubmitButton } from "@/components/forms";
import { Card, NoPermission, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { listTemplates } from "@/server/domain/cases";
import { hasRole } from "@/server/domain/context";
import { listProjectOptions } from "@/server/domain/projects";
import { UUID_RE } from "@/server/pages";
import { createCaseAction } from "../actions";
import { CaseFields } from "../case-fields";

export const metadata = { title: "New case" };

export default async function NewCasePage({ searchParams }: { searchParams: Promise<{ projectId?: string; templateId?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!hasRole(ctx, "member")) return <NoPermission />;
  const db = getDb();
  const [projects, templates] = await Promise.all([listProjectOptions(db, ctx, { activeOnly: true }), listTemplates(db, ctx)]);
  const projectId = sp.projectId && UUID_RE.test(sp.projectId) ? sp.projectId : projects.length === 1 ? projects[0]!.id : undefined;
  return (
    <>
      <PageHeader title="New case" back={projectId ? { href: `/projects/${projectId}/cases`, label: "Project cases" } : { href: "/cases", label: "Cases" }} />
      <Card className="max-w-2xl p-5">
        <ActionForm action={createCaseAction} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Project" name="projectId" placeholder="Choose project…" defaultValue={projectId} options={projects.map((p) => ({ value: p.id, label: p.name }))} required />
            <Select
              label="Template"
              name="templateId"
              placeholder="Start empty"
              defaultValue={sp.templateId}
              options={templates.map((t) => ({ value: t.id, label: `${t.name} (${t.unitCount} items)` }))}
              hint="Copies the expected contents; you can change them afterwards"
            />
          </div>
          <CaseFields />
          <SubmitButton>Create case</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
