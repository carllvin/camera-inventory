import Link from "next/link";
import { Aperture, LogOut, Search } from "lucide-react";
import { sql } from "drizzle-orm";
import { MobileNav, Sidebar } from "@/components/nav";
import { ProjectSwitcher } from "@/components/project-switcher";
import { getCurrentProject } from "@/server/current-project";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { ROLE_LABEL } from "@/lib/format";
import { signOutAction } from "../(auth)/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  const { current, active } = await getCurrentProject();
  const [row] = await getDb().execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM issue WHERE workspace_id = ${ctx.workspaceId} AND status IN ('open','in_progress')`,
  );
  return (
    <div className="flex min-h-dvh">
      <Sidebar workspaceName={ctx.workspaceName} openIssues={row?.n ?? 0} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-border bg-bg/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 lg:px-8">
            <Link href="/" className="lg:hidden" aria-label="Dashboard">
              <Aperture className="size-6 text-accent" />
            </Link>
            <ProjectSwitcher projects={active} currentId={current?.id ?? null} />
            <div className="flex-1 sm:hidden" />
            <Link href="/search" className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-text sm:hidden" aria-label="Search">
              <Search className="size-5" />
            </Link>
            <form action="/search" className="relative hidden min-w-0 flex-1 sm:block" role="search">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <input
                type="search"
                name="q"
                placeholder="Search equipment, serials, cases, projects…"
                aria-label="Search"
                className="input h-9 rounded-full !py-1 pl-9 text-sm"
              />
            </form>
            <div className="hidden text-right text-xs leading-tight sm:block">
              <div className="font-medium">{ctx.user.name}</div>
              <div className="text-muted">{ROLE_LABEL[ctx.role]}</div>
            </div>
            <form action={signOutAction}>
              <button type="submit" className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-text" aria-label="Sign out" title="Sign out">
                <LogOut className="size-4" />
              </button>
            </form>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-28 lg:px-8 lg:pb-12">{children}</main>
      </div>
      <MobileNav />
    </div>
  );
}
