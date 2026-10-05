import Link from "next/link";
import { Building2, ChevronRight, FolderTree } from "lucide-react";
import { ActionForm, Field, Select, SubmitButton } from "@/components/forms";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/format";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { listMembers } from "@/server/domain/overview";
import { addMemberAction, changeRoleAction, renameWorkspaceAction } from "./actions";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await getCtx();
  const members = await listMembers(getDb(), ctx);
  const isAdmin = hasRole(ctx, "admin");
  const roles = Object.entries(ROLE_LABEL)
    .filter(([r]) => r !== "owner" || ctx.role === "owner")
    .map(([value, label]) => ({ value, label }));
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {[
              { href: "/settings/rental-houses", label: "Rental houses", icon: Building2, hint: "Contacts and aliases used on documents" },
              { href: "/settings/categories", label: "Categories", icon: FolderTree, hint: "Hierarchical equipment categories" },
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
            <CardHeader title="Workspace" />
            <div className="p-4">
              {isAdmin ? (
                <ActionForm action={renameWorkspaceAction} className="flex items-end gap-2">
                  <Field label="Name" name="name" defaultValue={ctx.workspaceName} className="flex-1" />
                  <SubmitButton variant="secondary">Rename</SubmitButton>
                </ActionForm>
              ) : (
                <p className="text-sm">{ctx.workspaceName}</p>
              )}
            </div>
          </Card>
        </div>
        <Card className="self-start">
          <CardHeader title={`Team (${members.length})`} />
          <ul className="divide-y divide-border">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {m.name} {m.id === ctx.userId && <span className="text-xs text-muted">(you)</span>}
                  </div>
                  <div className="truncate text-xs text-muted">{m.email}</div>
                </div>
                {isAdmin && m.id !== ctx.userId ? (
                  <ActionForm action={changeRoleAction.bind(null, m.id)} className="flex items-center gap-1">
                    <Select name="role" aria-label={`Role of ${m.name}`} defaultValue={m.role} options={roles} className="w-28" />
                    <SubmitButton variant="ghost" className="!px-2 text-xs">Save</SubmitButton>
                  </ActionForm>
                ) : (
                  <span className="text-xs text-muted">{ROLE_LABEL[m.role]}</span>
                )}
              </li>
            ))}
          </ul>
          {isAdmin && (
            <div className="border-t border-border p-4">
              <h3 className="mb-3 text-sm font-semibold">Add team member</h3>
              <ActionForm action={addMemberAction} className="grid gap-3 sm:grid-cols-2" resetOnSuccess>
                <Field label="Email" name="email" type="email" required className="sm:col-span-2" />
                <Field label="Name" name="name" hint="Only needed for new accounts" />
                <Select label="Role" name="role" defaultValue="member" options={roles.filter((r) => r.value !== "owner")} />
                <Field label="Temporary password" name="password" type="text" autoComplete="off" hint="Only for new accounts — hand it over in person" className="sm:col-span-2" />
                <div className="sm:col-span-2">
                  <SubmitButton>Add member</SubmitButton>
                </div>
              </ActionForm>
              <p className="mt-3 text-xs text-muted">
                Viewers can see everything but change nothing. Members manage projects and equipment. Admins also manage team and categories.
              </p>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
