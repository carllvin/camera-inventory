import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, NoPermission, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { getCategoryTree } from "@/server/domain/categories";
import { hasRole } from "@/server/domain/context";
import { createTypeAction } from "../../actions";
import { TypeFields } from "../type-fields";
import { getT } from "@/server/i18n";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("New equipment type") };
}

export default async function NewTypePage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo } = await searchParams;
  const ctx = await getCtx();
  const t = await getT();
  if (!hasRole(ctx, "member")) return <NoPermission />;
  const { flat } = await getCategoryTree(getDb(), ctx);
  return (
    <>
      <PageHeader title={t("New equipment type")} back={{ href: returnTo?.startsWith("/") ? returnTo : "/equipment/types", label: t("Back") }} />
      <Card className="max-w-2xl p-5">
        <ActionForm action={createTypeAction} className="space-y-5">
          <input type="hidden" name="returnTo" value={returnTo ?? ""} />
          <TypeFields categories={flat.map((c) => ({ value: c.id, label: c.path }))} />
          <SubmitButton>{t("Create equipment type")}</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
