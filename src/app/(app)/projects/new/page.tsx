import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, NoPermission, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { hasRole } from "@/server/domain/context";
import { createProjectAction } from "../actions";
import { ProjectFields } from "../project-fields";

export const metadata = { title: "New project" };

export default async function NewProjectPage() {
  if (!hasRole(await getCtx(), "member")) return <NoPermission />;
  return (
    <>
      <PageHeader title="New project" back={{ href: "/projects", label: "Projects" }} />
      <Card className="max-w-2xl p-5">
        <ActionForm action={createProjectAction} className="space-y-5">
          <ProjectFields />
          <SubmitButton>Create project</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
