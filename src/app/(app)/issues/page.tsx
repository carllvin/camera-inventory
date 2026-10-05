import { IssueList } from "@/components/issues";
import { Card, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { listIssues } from "@/server/domain/overview";

export const metadata = { title: "Issues" };

export default async function IssuesPage() {
  const issues = await listIssues(getDb(), await getCtx());
  return (
    <>
      <PageHeader title="Issues" subtitle="Missing and damaged equipment, conflicts and mismatches" />
      <Card>
        <IssueList issues={issues} />
      </Card>
    </>
  );
}
