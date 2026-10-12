import Link from "next/link";
import { CalendarLinkCard } from "@/components/calendar-link";
import { CalendarView } from "@/components/calendar-view";
import { Card, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getCurrentProject } from "@/server/current-project";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { getReminderSettings } from "@/server/domain/reminders";
import { getT } from "@/server/i18n";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Calendar") };
}

/** Workspace calendar, scoped by the project chosen in the top bar. */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; add?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const [{ current }, t, settings] = await Promise.all([getCurrentProject(), getT(), getReminderSettings(getDb(), ctx.userId)]);
  return (
    <>
      <PageHeader title={t("Calendar")} subtitle={current ? current.name : t("All projects")} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <CalendarView ctx={ctx} projectId={current?.id ?? null} basePath="/calendar" month={sp.month} add={sp.add} canEdit={hasRole(ctx, "member")} />
        </div>
        <div className="space-y-6">
          <CalendarLinkCard token={settings.calendarToken} />
          <Card className="p-4 text-sm">
            <p className="text-muted">
              {t("Reminders on your phone: set up ntfy in Settings → Reminders.")}{" "}
              <Link href="/settings#reminders" className="text-accent hover:underline">
                {t("Open settings")}
              </Link>
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
