import Link from "next/link";
import { Building2, ChevronRight, FolderTree, ImageIcon, Library } from "lucide-react";
import { ActionForm, Field, Select, SubmitButton } from "@/components/forms";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { eq } from "drizzle-orm";
import { ROLE_LABEL } from "@/lib/format";
import { LOCALE_LABEL, LOCALES } from "@/lib/i18n/core";
import * as s from "@/server/db/schema";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { listMembers } from "@/server/domain/overview";
import { getT } from "@/server/i18n";
import { addMemberAction, changeRoleAction, renameWorkspaceAction, saveRemindersAction, setLanguageAction, testReminderAction } from "./actions";
import { CalendarLinkCard } from "@/components/calendar-link";
import { DEFAULT_NTFY_SERVER, getReminderSettings } from "@/server/domain/reminders";
import { randomBytes } from "node:crypto";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Settings") };
}

export default async function SettingsPage() {
  const ctx = await getCtx();
  const members = await listMembers(getDb(), ctx);
  const [me] = await getDb().select({ locale: s.user.locale }).from(s.user).where(eq(s.user.id, ctx.userId));
  const reminders = await getReminderSettings(getDb(), ctx.userId);
  const suggestedTopic = `camera-${randomBytes(6).toString("hex")}`;
  const isAdmin = hasRole(ctx, "admin");
  const t = await getT();
  const roles = Object.entries(ROLE_LABEL)
    .filter(([r]) => r !== "owner" || ctx.role === "owner")
    .map(([value, label]) => ({ value, label: t(label) }));
  return (
    <>
      <PageHeader title={t("Settings")} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {[
              { href: "/settings/rental-houses", label: t("Rental houses"), icon: Building2, hint: t("Contacts and aliases used on documents") },
              { href: "/settings/categories", label: t("Categories"), icon: FolderTree, hint: t("Hierarchical equipment categories") },
              { href: "/settings/catalog", label: t("Standard catalog"), icon: Library, hint: t("Import common equipment types and rental houses") },
              { href: "/settings/images", label: t("Automatic images"), icon: ImageIcon, hint: t("Find reference images for many equipment types at once") },
            ].map(({ href, label, icon: Icon, hint }) => (
              <li key={href}>
                <Link href={href} className="flex items-center gap-3 px-4 py-3.5 hover:bg-surface-2">
                  <Icon className="size-5 text-muted" />
                  <div className="flex-1">
                    <div className="font-medium">{label}</div>
                    <div className="text-xs text-muted">{hint}</div>
                  </div>
                  <ChevronRight className="size-4 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
          <Card>
            <CardHeader title="Language · Sprache" />
            <div className="p-4">
              <ActionForm action={setLanguageAction} className="flex items-end gap-2">
                <Select
                  label={t("Interface language")}
                  name="locale"
                  defaultValue={me?.locale ?? ""}
                  options={[{ value: "", label: t("Automatic (browser)") }, ...LOCALES.map((l) => ({ value: l, label: LOCALE_LABEL[l] }))]}
                  className="flex-1"
                />
                <SubmitButton variant="secondary">{t("Save")}</SubmitButton>
              </ActionForm>
            </div>
          </Card>
          <Card id="reminders">
            <CardHeader title={t("Reminders")} />
            <div className="space-y-3 p-4">
              <p className="text-sm text-muted">
                {t("A daily summary on your phone via ntfy: what is overdue, what goes back soon, what to order. Install the ntfy app and subscribe to your topic.")}
              </p>
              <ActionForm action={saveRemindersAction} className="grid gap-3 sm:grid-cols-2">
                <Field label={t("ntfy topic")} name="ntfyTopic" defaultValue={reminders.ntfyTopic ?? ""} placeholder={suggestedTopic} spellCheck={false} autoComplete="off" hint={t("Long and hard to guess: anyone who knows it can read it.")} />
                <Field label={t("ntfy server")} name="ntfyServer" defaultValue={reminders.ntfyServer ?? ""} placeholder={DEFAULT_NTFY_SERVER} spellCheck={false} autoComplete="off" hint={t("Empty = {server}", { server: DEFAULT_NTFY_SERVER })} />
                <Select
                  label={t("Time")}
                  name="reminderHour"
                  defaultValue={String(reminders.reminderHour)}
                  options={Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, "0")}:00` }))}
                />
                <Select
                  label={t("Look ahead")}
                  name="reminderDaysBefore"
                  defaultValue={String(reminders.reminderDaysBefore)}
                  options={[0, 1, 2, 3, 5, 7].map((d) => ({ value: String(d), label: d === 0 ? t("Only today") : d === 1 ? t("Today and tomorrow") : t("The next {n} days", { n: d }) }))}
                />
                <Field
                  label={t("Access token (optional)")}
                  name="ntfyToken"
                  type="password"
                  autoComplete="off"
                  className="sm:col-span-2"
                  hint={reminders.hasToken ? t("A token is saved. Leave empty to keep it, enter - to remove it.") : t("Only for protected topics on your own server.")}
                />
                <div className="sm:col-span-2">
                  <SubmitButton variant="secondary">{t("Save reminders")}</SubmitButton>
                </div>
              </ActionForm>
              {reminders.ntfyTopic && (
                <ActionForm action={testReminderAction}>
                  <SubmitButton variant="ghost" className="!px-2.5 text-xs">{t("Send now (test)")}</SubmitButton>
                </ActionForm>
              )}
            </div>
          </Card>
          <CalendarLinkCard token={reminders.calendarToken} />
          <Card>
            <CardHeader title={t("Workspace")} />
            <div className="p-4">
              {isAdmin ? (
                <ActionForm action={renameWorkspaceAction} className="flex items-end gap-2">
                  <Field label={t("Name")} name="name" defaultValue={ctx.workspaceName} className="flex-1" />
                  <SubmitButton variant="secondary">{t("Rename")}</SubmitButton>
                </ActionForm>
              ) : (
                <p className="text-sm">{ctx.workspaceName}</p>
              )}
            </div>
          </Card>
        </div>
        <Card className="self-start">
          <CardHeader title={t("Team ({n})", { n: members.length })} />
          <ul className="divide-y divide-border">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {m.name} {m.id === ctx.userId && <span className="text-xs text-muted">{t("(you)")}</span>}
                  </div>
                  <div className="truncate text-xs text-muted">{m.email}</div>
                </div>
                {isAdmin && m.id !== ctx.userId ? (
                  <ActionForm action={changeRoleAction.bind(null, m.id)} className="flex items-center gap-1">
                    <Select name="role" aria-label={t("Role of {name}", { name: m.name })} defaultValue={m.role} options={roles} className="w-28" />
                    <SubmitButton variant="ghost" className="!px-2 text-xs">{t("Save")}</SubmitButton>
                  </ActionForm>
                ) : (
                  <span className="text-xs text-muted">{ROLE_LABEL[m.role] && t(ROLE_LABEL[m.role]!)}</span>
                )}
              </li>
            ))}
          </ul>
          {isAdmin && (
            <div className="border-t border-border p-4">
              <h3 className="mb-3 text-sm font-semibold">{t("Add team member")}</h3>
              <ActionForm action={addMemberAction} className="grid gap-3 sm:grid-cols-2" resetOnSuccess>
                <Field label={t("Email")} name="email" type="email" required className="sm:col-span-2" />
                <Field label={t("Name")} name="name" hint={t("Only needed for new accounts")} />
                <Select label={t("Role")} name="role" defaultValue="member" options={roles.filter((r) => r.value !== "owner")} />
                <Field label={t("Temporary password")} name="password" type="text" autoComplete="off" hint={t("Only for new accounts — hand it over in person")} className="sm:col-span-2" />
                <div className="sm:col-span-2">
                  <SubmitButton>{t("Add member")}</SubmitButton>
                </div>
              </ActionForm>
              <p className="mt-3 text-xs text-muted">
                {t("Viewers can see everything but change nothing. Members manage projects and equipment. Admins also manage team and categories.")}
              </p>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
