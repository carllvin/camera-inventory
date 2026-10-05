import Link from "next/link";
import { ActivityList } from "@/components/activity";
import { Card, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { listActivity } from "@/server/domain/overview";

export const metadata = { title: "History" };
const PAGE = 100;

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const { before } = await searchParams;
  const m = before?.match(/^(\d+)_(\d+)$/);
  const cursor = m ? { atMicros: m[1]!, id: Number(m[2]) } : undefined;
  const events = await listActivity(getDb(), await getCtx(), { limit: PAGE, before: cursor });
  const last = events.at(-1);
  return (
    <>
      <PageHeader title="History" subtitle="Every recorded change. Entries can never be edited or deleted." />
      <Card>
        <ActivityList events={events} />
      </Card>
      <div className="mt-4 flex gap-3 text-sm">
        {cursor && (
          <Link href="/history" className="text-muted hover:text-text">
            ← Newest
          </Link>
        )}
        {events.length === PAGE && last && (
          <Link href={`/history?before=${last.cursorMicros}_${last.id}`} className="text-accent hover:underline">
            Older entries →
          </Link>
        )}
      </div>
    </>
  );
}
