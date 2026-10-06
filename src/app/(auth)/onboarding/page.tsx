import { redirect } from "next/navigation";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { getSessionUser, userHasWorkspace } from "@/server/auth/context";
import { createWorkspaceAction } from "../actions";

export const metadata = { title: "Set up workspace" };

export default async function OnboardingPage() {
  const current = await getSessionUser();
  if (!current) redirect("/login");
  if (await userHasWorkspace(current.user.id)) redirect("/");
  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold tracking-tight">Set up your workspace</h1>
      <p className="mb-6 text-sm text-muted">
        A workspace holds your projects, equipment and team. You can rename it later.
      </p>
      <ActionForm action={createWorkspaceAction} className="space-y-4">
        <Field label="Department or company name" name="name" placeholder="e.g. Nordlicht Camera Department" required autoFocus />
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <input type="checkbox" name="standardCatalog" value="on" defaultChecked className="mt-0.5 size-4 accent-[var(--accent)]" />
          <span>
            Start with the standard equipment catalog
            <span className="block text-xs text-muted">About 400 common cameras, lenses (per focal length) and accessories. You can edit, archive or add to it later.</span>
          </span>
        </label>
        <SubmitButton className="w-full" pendingText="Creating…">
          Create workspace
        </SubmitButton>
      </ActionForm>
    </>
  );
}
