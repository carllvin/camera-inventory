import { ActionForm, Field, Select, SubmitButton } from "@/components/forms";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { getCategoryTree, type CategoryNode } from "@/server/domain/categories";
import { hasRole } from "@/server/domain/context";
import { createCategoryAction, updateCategoryAction } from "../actions";

export const metadata = { title: "Categories" };

function descendants(node: CategoryNode): string[] {
  return node.children.flatMap((c) => [c.id, ...descendants(c)]);
}

export default async function CategoriesPage() {
  const ctx = await getCtx();
  const { flat } = await getCategoryTree(getDb(), ctx);
  const isAdmin = hasRole(ctx, "admin");
  const parentOptions = flat.map((c) => ({ value: c.id, label: c.path }));
  return (
    <>
      <PageHeader title="Categories" subtitle="Used for filtering, templates and matching" back={{ href: "/settings", label: "Settings" }} />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
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
                        <span className="text-xs text-muted">{c.typeCount} types · edit</span>
                      </summary>
                      <ActionForm action={updateCategoryAction.bind(null, c.id)} className="mt-2 grid gap-2 pb-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                        <Field label="Name" name="name" defaultValue={c.name} />
                        <Select
                          label="Parent"
                          name="parentId"
                          placeholder="— Top level —"
                          defaultValue={c.parentId}
                          options={parentOptions.filter((o) => !blocked.has(o.value))}
                        />
                        <SubmitButton variant="secondary">Save</SubmitButton>
                      </ActionForm>
                    </details>
                  ) : (
                    <div className="flex justify-between text-sm">
                      <span className={c.depth === 0 ? "font-semibold" : ""}>{c.name}</span>
                      <span className="text-xs text-muted">{c.typeCount} types</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
        {isAdmin && (
          <Card className="self-start">
            <CardHeader title="Add category" />
            <ActionForm action={createCategoryAction} className="space-y-3 p-4" resetOnSuccess>
              <Field label="Name" name="name" required />
              <Select label="Parent" name="parentId" placeholder="— Top level —" options={parentOptions} />
              <SubmitButton>Add</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
