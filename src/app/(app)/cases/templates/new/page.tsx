import { ActionForm, Field, SubmitButton, TextArea } from "@/components/forms";
import { Card, NoPermission, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { hasRole } from "@/server/domain/context";
import { createTemplateAction } from "../../actions";

export const metadata = { title: "New case template" };

export default async function NewTemplatePage() {
  if (!hasRole(await getCtx(), "member")) return <NoPermission />;
  return (
    <>
      <PageHeader title="New case template" back={{ href: "/cases/templates", label: "Templates" }} />
      <Card className="max-w-xl p-5">
        <ActionForm action={createTemplateAction} className="space-y-4">
          <Field label="Name" name="name" required placeholder="A-Cam Case" />
          <TextArea label="Description" name="description" />
          <SubmitButton>Create and add items</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
