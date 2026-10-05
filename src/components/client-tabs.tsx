"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/format";

/** Link tabs whose active state follows the URL (for use in layouts). */
export function ClientTabs({ tabs }: { tabs: { href: string; label: string; count?: number; exact?: boolean }[] }) {
  const pathname = usePathname();
  return (
    <nav className="-mx-4 mb-4 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0" aria-label="Sections">
      <ul className="flex gap-1">
        {tabs.map((t) => {
          const active = t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm whitespace-nowrap",
                  active ? "border-accent font-medium text-text" : "border-transparent text-muted hover:text-text",
                )}
              >
                {t.label}
                {t.count !== undefined && <span className="rounded bg-surface-2 px-1.5 text-xs text-muted">{t.count}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
