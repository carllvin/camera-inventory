import Link from "next/link";
import { ActivityList } from "@/components/activity";
import { Card, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { getCurrentProject } from "@/server/current-project";
import { listActivity } from "@/server/domain/overview";
import { getT } from "@/server/i18n";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("History") };
}
const PAGE = 100;

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const { before } = await searchParams;
  const m = before?.match(/^(\d+)_(\d+)$/);
  const cursor = m ? { atMicros: m[1]!, id: Number(m[2]) } : undefined;
  const { current } = await getCurrentProject();
  const events = await listActivity(getDb(), await getCtx(), { limit: PAGE, before: cursor, projectId: current?.id });
  const last = events.at(-1);
  const t = await getT();
  return (
    <>
      <PageHeader title={t("History")}
        subtitle={current ? t("Every recorded change on {project}. Switch to All projects in the top bar for everything.", { project: current.name }) : t("Every recorded change. Entries can never be edited or deleted.")} />
      <Card>
        <ActivityList events={events} showProject={!current} />
      </Card>
      <div className="mt-4 flex gap-3 text-sm">
        {cursor && (
          <Link href="/history" className="text-muted hover:text-text">
            {t("← Newest")}
          </Link>
        )}
        {events.length === PAGE && last && (
          <Link href={`/history?before=${last.cursorMicros}_${last.id}`} className="text-accent hover:underline">
            {t("Older entries →")}
          </Link>
        )}
      </div>
    </>
  );
}
