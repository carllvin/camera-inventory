import { IssueList } from "@/components/issues";
import { Card, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { getCurrentProject } from "@/server/current-project";
import { listIssues } from "@/server/domain/overview";

export const metadata = { title: "Issues" };

export default async function IssuesPage() {
  const { current } = await getCurrentProject();
  const issues = await listIssues(getDb(), await getCtx(), { projectId: current?.id });
  return (
    <>
      <PageHeader title="Issues" subtitle={current ? `Missing and damaged equipment, conflicts and mismatches on ${current.name}` : "Missing and damaged equipment, conflicts and mismatches"} />
      <Card>
        <IssueList issues={issues} showProject={!current} />
      </Card>
    </>
  );
}
