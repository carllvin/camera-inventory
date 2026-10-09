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
  LayoutDashboard,
  Menu,
  ScanLine,
  Settings,
} from "lucide-react";
import { Logo } from "./logo";
import { cn } from "@/lib/format";

const DESKTOP = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: Briefcase },
  { href: "/equipment", label: "Equipment", icon: Camera },
  { href: "/sets", label: "Sets", icon: Boxes },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/issues", label: "Issues", icon: CircleAlert },
  { href: "/history", label: "History", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ workspaceName, openIssues }: { workspaceName: string; openIssues: number }) {
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
      <nav className="flex-1 px-3" aria-label="Main">
        <ul className="space-y-0.5">
          {DESKTOP.map(({ href, label, icon: Icon }) => {
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
          <ScanLine className="size-4" aria-hidden /> Scan
        </Link>
      </div>
    </aside>
    </div>
  );
}

const MOBILE = [
  { href: "/projects", label: "Projects", icon: Briefcase },
  { href: "/equipment", label: "Equipment", icon: Camera },
  { href: "/scan", label: "Scan", icon: ScanLine, primary: true },
  { href: "/sets", label: "Sets", icon: Boxes },
  { href: "/more", label: "More", icon: Menu },
];

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur lg:hidden" aria-label="Main">
      <ul className="mx-auto grid max-w-md grid-cols-5 items-end px-2 pt-1.5">
        {MOBILE.map(({ href, label, icon: Icon, primary }) => {
          const active = isActive(pathname, href) || (href === "/more" && ["/more", "/documents", "/issues", "/history", "/settings", "/search"].some((p) => isActive(pathname, p)));
          if (primary) {
            return (
              <li key={href} className="flex justify-center">
                <Link
                  href={href}
                  className="-mt-5 flex size-14 flex-col items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg ring-4 ring-bg"
                  aria-label="Scan"
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
