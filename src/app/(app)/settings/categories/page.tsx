import { ActionForm, Field, Select, SubmitButton } from "@/components/forms";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { getCategoryTree, type CategoryNode } from "@/server/domain/categories";
import { hasRole } from "@/server/domain/context";
import { getT } from "@/server/i18n";
import { createCategoryAction, updateCategoryAction } from "../actions";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Categories") };
}

function descendants(node: CategoryNode): string[] {
  return node.children.flatMap((c) => [c.id, ...descendants(c)]);
}

export default async function CategoriesPage() {
  const ctx = await getCtx();
  const { flat } = await getCategoryTree(getDb(), ctx);
  const isAdmin = hasRole(ctx, "admin");
  const t = await getT();
  const parentOptions = flat.map((c) => ({ value: c.id, label: c.path }));
  return (
    <>
      <PageHeader title={t("Categories")} subtitle={t("Used for filtering, templates and matching")} back={{ href: "/settings", label: t("Settings") }} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <ul className="divide-y divide-border">
            {flat.map((c) => {
              const blocked = new Set([c.id, ...descendants(c)]);
              return (
                <li key={c.id} className="px-4 py-2" style={{ paddingLeft: `${1 + c.depth * 1.5}rem` }}>
                  {isAdmin ? (
                    <details>
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm">
                        <span className={c.depth === 0 ? "font-semibold" : ""}>{c.name}</span>
                        <span className="text-xs text-muted">{t("{n} types · edit", { n: c.typeCount })}</span>
                      </summary>
                      <ActionForm action={updateCategoryAction.bind(null, c.id)} className="mt-2 grid gap-2 pb-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                        <Field label={t("Name")} name="name" defaultValue={c.name} />
                        <Select
                          label={t("Parent")}
                          name="parentId"
                          placeholder={t("— Top level —")}
                          defaultValue={c.parentId}
                          options={parentOptions.filter((o) => !blocked.has(o.value))}
                        />
                        <SubmitButton variant="secondary">{t("Save")}</SubmitButton>
                      </ActionForm>
                    </details>
                  ) : (
                    <div className="flex justify-between text-sm">
                      <span className={c.depth === 0 ? "font-semibold" : ""}>{c.name}</span>
                      <span className="text-xs text-muted">{t("{n} types", { n: c.typeCount })}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
        {isAdmin && (
          <Card className="self-start">
            <CardHeader title={t("Add category")} />
            <ActionForm action={createCategoryAction} className="space-y-3 p-4" resetOnSuccess>
              <Field label={t("Name")} name="name" required />
              <Select label={t("Parent")} name="parentId" placeholder={t("— Top level —")} options={parentOptions} />
              <SubmitButton>{t("Add")}</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
