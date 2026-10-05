import { ActivityList } from "@/components/activity";
import { Card } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { listActivity } from "@/server/domain/overview";

export default async function ProjectHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const events = await listActivity(getDb(), await getCtx(), { projectId: id, limit: 300 });
  return (
    <Card>
      <ActivityList events={events} showProject={false} />
    </Card>
  );
}
