import { EmptyState, LinkButton } from "@/components/ui";
import { getT } from "@/server/i18n";

export default async function NotFound() {
  const t = await getT();
  return (
    <EmptyState title={t("Not found")} action={<LinkButton href="/">{t("Back to dashboard")}</LinkButton>}>
      {t("This page does not exist, or it belongs to another workspace.")}
    </EmptyState>
  );
}
