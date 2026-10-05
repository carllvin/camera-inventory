import Link from "next/link";
import { ChevronRight, CircleAlert, FileText, History, LayoutDashboard, LogOut, Search, Settings } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { signOutAction } from "../../(auth)/actions";

export const metadata = { title: "More" };

const LINKS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/search", label: "Search", icon: Search },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/issues", label: "Issues", icon: CircleAlert },
  { href: "/history", label: "History", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default async function MorePage() {
  const ctx = await getCtx();
  return (
    <>
      <PageHeader title="More" subtitle={`${ctx.user.name} · ${ctx.workspaceName}`} />
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
          <LogOut className="size-5" /> Sign out
        </button>
      </form>
    </>
  );
}
