"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes,
  Briefcase,
  Camera,
  CircleAlert,
  FileText,
  History,
  Menu,
  ScanLine,
  Settings,
  CalendarDays,
} from "lucide-react";
import { Logo } from "./logo";
import { cn } from "@/lib/format";
import type { T } from "@/lib/i18n/core";
import { useT } from "./i18n";

const desktop = (t: T) => [
  { href: "/projects", label: t("Projects"), icon: Briefcase },
  { href: "/equipment", label: t("Equipment"), icon: Camera },
  { href: "/sets", label: t("Sets"), icon: Boxes },
  { href: "/documents", label: t("Documents"), icon: FileText },
  { href: "/calendar", label: t("Calendar"), icon: CalendarDays },
  { href: "/issues", label: t("Issues"), icon: CircleAlert },
  { href: "/history", label: t("History"), icon: History },
  { href: "/settings", label: t("Settings"), icon: Settings },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ workspaceName, openIssues }: { workspaceName: string; openIssues: number }) {
  const t = useT();
  const pathname = usePathname();
  return (
    <div className="hidden w-60 shrink-0 border-r border-border bg-surface lg:block">
    <aside className="sticky top-0 flex h-dvh flex-col">
      <div className="flex items-center gap-2 px-5 py-5">
        <Logo className="size-7 shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight">Camera Inventory</div>
          <div className="truncate text-xs text-muted">{workspaceName}</div>
        </div>
      </div>
      <nav className="flex-1 px-3" aria-label={t("Main")}>
        <ul className="space-y-0.5">
          {desktop(t).map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm",
                    active ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface-2 hover:text-text",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  <span className="flex-1">{label}</span>
                  {href === "/issues" && openIssues > 0 && (
                    <span className="rounded-full bg-danger px-1.5 text-[11px] font-semibold text-white">{openIssues}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="p-3">
        <Link href="/scan" className="flex items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2.5 text-sm font-medium text-accent-fg hover:brightness-110">
          <ScanLine className="size-4" aria-hidden /> {t("Scan")}
        </Link>
      </div>
    </aside>
    </div>
  );
}

const mobile = (t: T) => [
  { href: "/projects", label: t("Projects"), icon: Briefcase },
  { href: "/equipment", label: t("Equipment"), icon: Camera },
  { href: "/scan", label: t("Scan"), icon: ScanLine, primary: true },
  { href: "/sets", label: t("Sets"), icon: Boxes },
  { href: "/more", label: t("More"), icon: Menu },
];

export function MobileNav() {
  const t = useT();
  const pathname = usePathname();
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur lg:hidden" aria-label={t("Main")}>
      <ul className="mx-auto grid max-w-md grid-cols-5 items-end px-2 pt-1.5">
        {mobile(t).map(({ href, label, icon: Icon, primary }) => {
          const active = isActive(pathname, href) || (href === "/more" && ["/more", "/documents", "/issues", "/history", "/settings", "/search"].some((p) => isActive(pathname, p)));
          if (primary) {
            return (
              <li key={href} className="flex justify-center">
                <Link
                  href={href}
                  className="-mt-5 flex size-14 flex-col items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg ring-4 ring-bg"
                  aria-label={t("Scan")}
                >
                  <Icon className="size-6" aria-hidden />
                </Link>
              </li>
            );
          }
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn("flex flex-col items-center gap-0.5 py-1 text-[11px]", active ? "text-accent" : "text-muted")}
              >
                <Icon className="size-5" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
