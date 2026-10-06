import { Plus } from "lucide-react";
import { ActionForm, Field, SubmitButton, TextArea } from "@/components/forms";
import { AddLineForm, LineEditor } from "@/components/line-editor";
import { Card, CardHeader, LinkButton, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { getTemplate, listLineTargets } from "@/server/domain/cases";
import { hasRole } from "@/server/domain/context";
import { assertUuid, orNotFound } from "@/server/pages";
import { addTemplateLineAction, archiveTemplateAction, removeTemplateLineAction, updateTemplateAction, updateTemplateLineAction } from "../../actions";

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  assertUuid(id);
  const ctx = await getCtx();
  const db = getDb();
  const [tpl, targets] = await Promise.all([orNotFound(getTemplate(db, ctx, id)), listLineTargets(db, ctx)]);
  const canEdit = hasRole(ctx, "member") && !tpl.archivedAt;
  const total = tpl.lines.reduce((n, l) => n + l.quantity, 0);
  return (
    <>
      <PageHeader
        title={tpl.name}
        subtitle={`${total} items · ${tpl.lines.length} lines${tpl.archivedAt ? " · archived" : ""}`}
        back={{ href: "/cases/templates", label: "Templates" }}
        actions={canEdit && <LinkButton href={`/cases/new?templateId=${id}`} variant="primary"><Plus className="size-4" /> New case from template</LinkButton>}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader title="Expected contents" />
          <div className="space-y-4 p-4">
            {canEdit ? (
              <>
                <LineEditor
                  lines={tpl.lines.map((l) => ({
                    id: l.id,
                    label: l.label,
                    quantity: l.quantity,
                    typeName: l.typeName,
                    categoryName: l.categoryName,
                    updateAction: updateTemplateLineAction.bind(null, id, l.id),
                    removeAction: removeTemplateLineAction.bind(null, id, l.id),
                  }))}
                />
                <div className="border-t border-border pt-4">
                  <h3 className="mb-2 text-sm font-medium">Add item</h3>
                  <AddLineForm action={addTemplateLineAction.bind(null, id)} categories={targets.categories} />
                </div>
              </>
            ) : (
              <ul className="space-y-1 text-sm">
                {tpl.lines.map((l) => (
                  <li key={l.id}>
                    {l.quantity} × {l.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
        {canEdit && (
          <div className="space-y-6">
            <Card>
              <CardHeader title="Details" />
              <ActionForm action={updateTemplateAction.bind(null, id)} className="space-y-3 p-4">
                <Field label="Name" name="name" defaultValue={tpl.name} />
                <TextArea label="Description" name="description" defaultValue={tpl.description} />
                <SubmitButton variant="secondary">Save</SubmitButton>
              </ActionForm>
            </Card>
            <Card>
              <CardHeader title="Archive template" />
              <ActionForm action={archiveTemplateAction.bind(null, id)} className="space-y-3 p-4">
                <p className="text-sm text-muted">Cases already created from it keep their expected contents.</p>
                <SubmitButton variant="danger">Archive</SubmitButton>
              </ActionForm>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
