import { ActionForm, Field, SubmitButton, TextArea } from "@/components/forms";
import { Card, NoPermission, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { hasRole } from "@/server/domain/context";
import { getT } from "@/server/i18n";
import { createTemplateAction } from "../../actions";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("New set template") };
}

export default async function NewTemplatePage() {
  if (!hasRole(await getCtx(), "member")) return <NoPermission />;
  const t = await getT();
  return (
    <>
      <PageHeader title={t("New set template")} back={{ href: "/sets/templates", label: t("Templates") }} />
      <Card className="max-w-xl p-5">
        <ActionForm action={createTemplateAction} className="space-y-4">
          <Field label={t("Name")} name="name" required placeholder="A-Cam Set" />
          <TextArea label={t("Description")} name="description" />
          <SubmitButton>{t("Create and add items")}</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
