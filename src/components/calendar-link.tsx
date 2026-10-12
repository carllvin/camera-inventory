import { disableCalendarLinkAction, rotateCalendarLinkAction } from "@/app/(app)/calendar/actions";
import { getT } from "@/server/i18n";
import { publicBaseUrl } from "@/server/public-url";
import { CopyField } from "./copy-field";
import { ActionForm, SubmitButton } from "./forms";
import { Card, CardHeader } from "./ui";

/** The personal calendar subscription (ICS): create, copy, renew or switch off. */
export async function CalendarLinkCard({ token }: { token: string | null }) {
  const t = await getT();
  const url = token ? `${await publicBaseUrl()}/api/calendar/${token}` : null;
  return (
    <Card>
      <CardHeader title={t("Subscribe in your calendar")} />
      <div className="space-y-3 p-4 text-sm">
        <p className="text-muted">
          {t("Return dates, extra equipment and project dates in Apple, Google or Outlook calendar. The link is personal: whoever has it sees your projects' dates.")}
        </p>
        {url ? (
          <>
            <CopyField value={url} label={t("Calendar link")} />
            <div className="flex flex-wrap gap-2">
              <a href={url.replace(/^https?:/, "webcal:")} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:brightness-110">
                {t("Open in calendar app")}
              </a>
              <ActionForm action={rotateCalendarLinkAction}>
                <SubmitButton variant="ghost" className="!px-2.5 !py-1.5 text-xs">{t("New link")}</SubmitButton>
              </ActionForm>
              <ActionForm action={disableCalendarLinkAction}>
                <SubmitButton variant="ghost" className="!px-2.5 !py-1.5 text-xs">{t("Switch off")}</SubmitButton>
              </ActionForm>
            </div>
          </>
        ) : (
          <ActionForm action={rotateCalendarLinkAction}>
            <SubmitButton variant="secondary">{t("Create calendar link")}</SubmitButton>
          </ActionForm>
        )}
      </div>
    </Card>
  );
}
