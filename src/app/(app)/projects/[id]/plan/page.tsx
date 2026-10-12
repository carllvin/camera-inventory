import Link from "next/link";
import { CalendarPlus } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { NeedFields } from "@/components/need-fields";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { todayIso } from "@/lib/format";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { listNeeds, type PlannedNeed } from "@/server/domain/planned-needs";
import { listRentalHouses } from "@/server/domain/rental-houses";
import { getFormat, getT, getTN } from "@/server/i18n";
import { cancelNeedAction, createNeedAction, restoreNeedAction, updateNeedAction } from "../../actions";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Plan extra equipment") };
}

export default async function ProjectPlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : undefined;
  const ctx = await getCtx();
  const db = getDb();
  const [t, tn, f] = await Promise.all([getT(), getTN(), getFormat()]);
  const [needs, houses] = await Promise.all([listNeeds(db, ctx, { projectId: id }), listRentalHouses(db, ctx)]);
  const canEdit = hasRole(ctx, "member");
  const today = todayIso();
  const open = needs.filter((n) => n.status === "open");
  const fulfilled = needs.filter((n) => n.status === "fulfilled");
  const cancelled = needs.filter((n) => n.status === "cancelled");
  const houseOptions = houses.map((h) => ({ value: h.id, label: h.name }));

  const fields = (n: PlannedNeed | null, key: string) => <NeedFields t={t} need={n} formKey={key} rentalHouses={houseOptions} from={key === "new" ? from : undefined} />;

  const span = (n: PlannedNeed) => (n.needFrom === n.needUntil ? f.formatDate(n.needFrom) : `${f.formatDate(n.needFrom)} – ${f.formatDate(n.needUntil)}`);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        {t("Extra equipment for a few days: you are reminded to order it, it shows in the calendar, and the delivery note that brings it fulfils the plan, so the pieces go back on its end date.")}
      </p>

      <Card>
        <CardHeader title={t("Planned ({n})", { n: open.length })} />
        {open.length === 0 ? (
          <EmptyState title={t("Nothing planned")} />
        ) : (
          <ul className="divide-y divide-border">
            {open.map((n) => {
              const late = n.orderBy && n.orderBy <= today && n.needFrom >= today;
              return (
                <li key={n.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <CalendarPlus className="size-4 text-violet-500" aria-hidden />
                    <span className="font-medium">
                      {n.quantity} × {tn(n.label)}
                    </span>
                    <span className="text-sm text-muted">{span(n)}</span>
                    {late && <Badge tone="warn">{t("Order now")}</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    {[n.orderBy ? t("Order by {date}", { date: f.formatDate(n.orderBy) }) : null, n.rentalHouseName, n.notes].filter(Boolean).join(" · ")}
                  </p>
                  {canEdit && (
                    <details className="mt-2 text-sm">
                      <summary className="cursor-pointer text-accent">{t("Change")}</summary>
                      <ActionForm action={updateNeedAction.bind(null, n.id)} className="mt-2 grid gap-3 sm:grid-cols-2">
                        {fields(n, n.id)}
                        <div className="flex gap-2 sm:col-span-2">
                          <SubmitButton variant="secondary">{t("Save")}</SubmitButton>
                        </div>
                      </ActionForm>
                      <ActionForm action={cancelNeedAction.bind(null, n.id)} className="mt-2">
                        <SubmitButton variant="ghost" className="!px-2 text-xs text-danger">{t("Cancel this plan")}</SubmitButton>
                      </ActionForm>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {canEdit && (
        <Card>
          <CardHeader title={t("Plan extra equipment")} />
          <ActionForm action={createNeedAction.bind(null, id)} className="grid gap-3 p-4 sm:grid-cols-2" resetOnSuccess>
            {fields(null, "new")}
            <div className="sm:col-span-2">
              <SubmitButton>{t("Add to plan")}</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      )}

      {fulfilled.length > 0 && (
        <Card>
          <CardHeader title={t("Delivered ({n})", { n: fulfilled.length })} />
          <ul className="divide-y divide-border text-sm">
            {fulfilled.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                <span>
                  {n.quantity} × {tn(n.label)}
                </span>
                <span className="text-muted">{span(n)}</span>
                {n.fulfilledDocumentId && (
                  <Link href={`/documents/${n.fulfilledDocumentId}`} className="text-xs text-accent hover:underline">
                    {t("Delivery note")}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {cancelled.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">{t("Cancelled ({n})", { n: cancelled.length })}</summary>
          <ul className="mt-2 divide-y divide-border rounded-xl border border-border bg-surface">
            {cancelled.map((n) => (
              <li key={n.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="text-muted line-through">
                  {n.quantity} × {tn(n.label)} · {span(n)}
                </span>
                {canEdit && (
                  <ActionForm action={restoreNeedAction.bind(null, n.id)}>
                    <SubmitButton variant="ghost" className="!px-2 text-xs">{t("Restore")}</SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
