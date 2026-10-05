import { IssueList } from "@/components/issues";
import { Card } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { listIssues } from "@/server/domain/overview";

export default async function ProjectIssuesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const issues = await listIssues(getDb(), await getCtx(), { projectId: id });
  return (
    <Card>
      <IssueList issues={issues} showProject={false} />
    </Card>
  );
}
