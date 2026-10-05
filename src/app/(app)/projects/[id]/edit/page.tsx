import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, NoPermission } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { getProject } from "@/server/domain/projects";
import { orNotFound } from "@/server/pages";
import { updateProjectAction } from "../../actions";
import { ProjectFields } from "../../project-fields";

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  if (!hasRole(ctx, "member")) return <NoPermission />;
  const project = await orNotFound(getProject(getDb(), ctx, id));
  return (
    <Card className="max-w-2xl p-5">
      <h2 className="mb-4 font-semibold">Edit project</h2>
      <ActionForm action={updateProjectAction.bind(null, id)} className="space-y-5">
        <ProjectFields defaults={project} />
        <SubmitButton>Save changes</SubmitButton>
      </ActionForm>
    </Card>
  );
}
