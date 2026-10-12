import Link from "next/link";
import { CalendarDays, ChevronRight, CircleAlert, FileText, History, LayoutDashboard, LogOut, Search, Settings } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getT } from "@/server/i18n";
import { signOutAction } from "../../(auth)/actions";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("More") };
}

export default async function MorePage() {
  const ctx = await getCtx();
  const t = await getT();
  const LINKS = [
    { href: "/", label: t("Dashboard"), icon: LayoutDashboard },
    { href: "/search", label: t("Search"), icon: Search },
    { href: "/calendar", label: t("Calendar"), icon: CalendarDays },
    { href: "/documents", label: t("Documents"), icon: FileText },
    { href: "/issues", label: t("Issues"), icon: CircleAlert },
    { href: "/history", label: t("History"), icon: History },
    { href: "/settings", label: t("Settings"), icon: Settings },
  ];
  return (
    <>
      <PageHeader title={t("More")} subtitle={`${ctx.user.name} · ${ctx.workspaceName}`} />
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        {LINKS.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link href={href} className="flex items-center gap-3 px-4 py-3.5 active:bg-surface-2">
              <Icon className="size-5 text-muted" />
              <span className="flex-1">{label}</span>
              <ChevronRight className="size-4 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
      <form action={signOutAction} className="mt-6">
        <button type="submit" className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3.5 text-danger">
          <LogOut className="size-5" /> {t("Sign out")}
        </button>
      </form>
    </>
  );
}
