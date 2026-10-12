import { CalendarClock } from "lucide-react";
import { clearReturnDueAction, setReturnDueAction, shiftReturnDueAction } from "@/app/(app)/return-actions";
import { todayIso } from "@/lib/format";
import type { DueSource, DueTarget } from "@/server/domain/return-dates";
import { daysBetween } from "@/server/domain/return-dates";
import { getFormat, getT } from "@/server/i18n";
import { ActionForm, Field, SubmitButton } from "./forms";
import { Badge, Card } from "./ui";

export interface ReturnDueInfo {
  /** The date that applies (own or inherited); null = none yet. */
  due: string | null;
  /** This thing's own date. */
  own: string | null;
  source: DueSource | null;
  /** "LS-1234" or the set's name, for "from delivery … / from set …". */
  sourceName?: string | null;
}

/** "Return by" with where the date comes from; members set, move or clear it. */
export async function ReturnDueCard({ target, info, canEdit }: { target: DueTarget; info: ReturnDueInfo; canEdit: boolean }) {
  const [t, f] = await Promise.all([getT(), getFormat()]);
  const today = todayIso();
  const left = info.due ? daysBetween(today, info.due) : null;
  const from =
    info.source === "item" || (target.kind !== "item" && info.own)
      ? t("Own date")
      : info.source === "case"
        ? t("From set {name}", { name: info.sourceName ?? "" })
        : info.source === "document"
          ? t("From delivery {number}", { number: info.sourceName ?? "" })
          : info.source === "project"
            ? t("Project end")
            : null;
  const scope =
    target.kind === "document"
      ? t("Applies to everything from this delivery without its own date or a set date.")
      : target.kind === "case"
        ? t("Applies to everything packed in this set without its own date.")
        : null;
  return (
    <Card className="p-4" aria-label={t("Return date")}>
      <div className="flex flex-wrap items-center gap-2">
        <CalendarClock className="size-4 text-muted" aria-hidden />
        <h2 className="text-sm font-semibold">{t("Return by")}</h2>
        <span className="text-sm font-medium tabular-nums">{info.due ? f.formatDate(info.due) : "—"}</span>
        {left !== null && left < 0 && <Badge tone="danger">{left === -1 ? t("1 day overdue") : t("{n} days overdue", { n: -left })}</Badge>}
        {left === 0 && <Badge tone="warn">{t("Today")}</Badge>}
        {left !== null && left > 0 && left <= 3 && <Badge tone="warn">{left === 1 ? t("Tomorrow") : t("in {n} days", { n: left })}</Badge>}
      </div>
      <p className="mt-1 text-xs text-muted">
        {from ?? t("No return date yet. Set one here, on the delivery note or as the project's end.")}
        {scope && <> · {scope}</>}
      </p>
      {canEdit && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <ActionForm action={setReturnDueAction.bind(null, target.kind, target.id)} className="flex items-end gap-2">
            <Field label={t("Own date")} name="returnDue" id={`return-due-${target.id}`} type="date" defaultValue={info.own ?? ""} className="w-40" />
            <SubmitButton variant="secondary">{t("Save")}</SubmitButton>
          </ActionForm>
          {info.due && (
            <div className="flex items-center gap-1" role="group" aria-label={t("Move return date")}>
              {([-1, 1, 7] as const).map((d) => (
                <ActionForm key={d} action={shiftReturnDueAction.bind(null, target.kind, target.id, d)}>
                  <SubmitButton variant="ghost" className="!px-2 !py-1 text-xs" pendingText="…" aria-label={d === 7 ? t("One week later") : d === 1 ? t("One day later") : t("One day earlier")}>
                    {d === 7 ? t("+1 week") : d === 1 ? t("+1 day") : t("−1 day")}
                  </SubmitButton>
                </ActionForm>
              ))}
            </div>
          )}
          {info.own && (
            <ActionForm action={clearReturnDueAction.bind(null, target.kind, target.id)}>
              <SubmitButton variant="ghost" className="!px-2 !py-1 text-xs" pendingText="…">
                {target.kind === "item" ? t("Follow set / delivery / project") : t("Follow the project's end")}
              </SubmitButton>
            </ActionForm>
          )}
        </div>
      )}
    </Card>
  );
}
