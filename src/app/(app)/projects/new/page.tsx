import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, NoPermission, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { hasRole } from "@/server/domain/context";
import { getT } from "@/server/i18n";
import { createProjectAction } from "../actions";
import { ProjectFields } from "../project-fields";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("New project") };
}

export default async function NewProjectPage() {
  if (!hasRole(await getCtx(), "member")) return <NoPermission />;
  const t = await getT();
  return (
    <>
      <PageHeader title={t("New project")} back={{ href: "/projects", label: t("Projects") }} />
      <Card className="max-w-2xl p-5">
        <ActionForm action={createProjectAction} className="space-y-5">
          <ProjectFields />
          <SubmitButton>{t("Create project")}</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
