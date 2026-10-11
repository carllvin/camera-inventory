import Link from "next/link";
import { getT } from "@/server/i18n";

export default async function NotFound() {
  const t = await getT();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-xl font-semibold">{t("Page not found")}</h1>
      <Link href="/" className="text-accent hover:underline">
        {t("Go to dashboard")}
      </Link>
    </main>
  );
}
