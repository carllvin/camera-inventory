import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, NoPermission } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { getProject, getProjectSummary } from "@/server/domain/projects";
import { getT } from "@/server/i18n";
import { orNotFound } from "@/server/pages";
import { deleteProjectAction, updateProjectAction } from "../../actions";
import { ProjectFields } from "../../project-fields";

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  if (!hasRole(ctx, "member")) return <NoPermission />;
  const db = getDb();
  const [project, { counts }] = await Promise.all([orNotFound(getProject(db, ctx, id)), getProjectSummary(db, ctx, id)]);
  const t = await getT();
  return (
    <div className="max-w-2xl space-y-6">
      <Card className="p-5">
        <h2 className="mb-4 font-semibold">{t("Edit project")}</h2>
        <ActionForm action={updateProjectAction.bind(null, id)} className="space-y-5">
          <ProjectFields defaults={project} />
          <SubmitButton>{t("Save changes")}</SubmitButton>
        </ActionForm>
      </Card>
      {hasRole(ctx, "admin") && !project.archivedAt && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">{t("Delete this project…")}</summary>
          <div className="mt-2 space-y-3 rounded-xl border border-border bg-surface p-4">
            {counts.units > 0 ? (
              <p className="text-warn">
                {counts.units === 1
                  ? t("1 piece is still on this project. Return or remove it first.")
                  : t("{n} pieces are still on this project. Return or remove them first.", { n: counts.units })}
              </p>
            ) : (
              <>
                <p className="text-muted">
                  {t(
                    "The project disappears from lists and the project switcher. Its documents and the equipment history keep it, and you can restore it under Projects → Deleted projects or undo it in the history.",
                  )}
                </p>
                <ActionForm action={deleteProjectAction.bind(null, id)}>
                  <SubmitButton variant="danger" pendingText={t("Deleting…")}>
                    {t("Delete {name}", { name: project.name })}
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
