import { IssueList } from "@/components/issues";
import { Card, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { getCurrentProject } from "@/server/current-project";
import { listIssues } from "@/server/domain/overview";
import { getT } from "@/server/i18n";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Issues") };
}

export default async function IssuesPage() {
  const { current } = await getCurrentProject();
  const issues = await listIssues(getDb(), await getCtx(), { projectId: current?.id });
  const t = await getT();
  return (
    <>
      <PageHeader title={t("Issues")}
        subtitle={current ? t("Missing and damaged equipment, conflicts and mismatches on {project}", { project: current.name }) : t("Missing and damaged equipment, conflicts and mismatches")} />
      <Card>
        <IssueList issues={issues} showProject={!current} />
      </Card>
    </>
  );
}
