import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, NoPermission } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { getProject, getProjectSummary } from "@/server/domain/projects";
import { orNotFound } from "@/server/pages";
import { deleteProjectAction, updateProjectAction } from "../../actions";
import { ProjectFields } from "../../project-fields";

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  if (!hasRole(ctx, "member")) return <NoPermission />;
  const db = getDb();
  const [project, { counts }] = await Promise.all([orNotFound(getProject(db, ctx, id)), getProjectSummary(db, ctx, id)]);
  return (
    <div className="max-w-2xl space-y-6">
      <Card className="p-5">
        <h2 className="mb-4 font-semibold">Edit project</h2>
        <ActionForm action={updateProjectAction.bind(null, id)} className="space-y-5">
          <ProjectFields defaults={project} />
          <SubmitButton>Save changes</SubmitButton>
        </ActionForm>
      </Card>
      {hasRole(ctx, "admin") && !project.archivedAt && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Delete this project…</summary>
          <div className="mt-2 space-y-3 rounded-xl border border-border bg-surface p-4">
            {counts.units > 0 ? (
              <p className="text-warn">
                {counts.units} piece{counts.units === 1 ? " is" : "s are"} still on this project. Return or remove {counts.units === 1 ? "it" : "them"} first.
              </p>
            ) : (
              <>
                <p className="text-muted">
                  The project disappears from lists and the project switcher. Its documents and the equipment history keep it, and you can restore it
                  under Projects → Deleted projects or undo it in the history.
                </p>
                <ActionForm action={deleteProjectAction.bind(null, id)}>
                  <SubmitButton variant="danger" pendingText="Deleting…">
                    Delete {project.name}
                  </SubmitButton>
                </ActionForm>
              </>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
