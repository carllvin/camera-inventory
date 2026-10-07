import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Card, CardHeader, NoPermission, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { getCaseDetail } from "@/server/domain/cases";
import { hasRole } from "@/server/domain/context";
import { assertUuid, orNotFound } from "@/server/pages";
import { archiveCaseAction, saveAsTemplateAction, updateCaseAction } from "../../actions";
import { CaseFields } from "../../case-fields";

export default async function EditCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  assertUuid(id);
  const ctx = await getCtx();
  if (!hasRole(ctx, "member")) return <NoPermission />;
  const d = await orNotFound(getCaseDetail(getDb(), ctx, id));
  return (
    <>
      <PageHeader title={`Edit ${d.case.name}`} back={{ href: `/sets/${id}`, label: d.case.name }} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="p-5">
          <ActionForm action={updateCaseAction.bind(null, id)} className="space-y-5">
            <CaseFields defaults={d.case} />
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Save as template" />
            <ActionForm action={saveAsTemplateAction.bind(null, id)} className="space-y-3 p-4">
              <p className="text-sm text-muted">Reuse this case’s expected contents ({d.comparison.expectedTotal} items) on other projects.</p>
              <Field name="name" id="template-name" label="Template name" defaultValue={d.case.name} />
              <SubmitButton variant="secondary">Save template</SubmitButton>
            </ActionForm>
          </Card>
          <Card>
            <CardHeader title="Archive set" />
            <ActionForm action={archiveCaseAction.bind(null, id)} className="space-y-3 p-4">
              <p className="text-sm text-muted">
                {d.items.length > 0
                  ? `Take out all ${d.items.length} items first. Archived sets keep their history.`
                  : "The set disappears from lists. Its history is kept."}
              </p>
              <SubmitButton variant="danger" disabled={d.items.length > 0}>
                Archive
              </SubmitButton>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
