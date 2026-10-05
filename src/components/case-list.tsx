import Link from "next/link";
import type { CaseSummary } from "@/server/domain/cases";
import { cn } from "@/lib/format";
import { EmptyState } from "./ui";

/** "7 / 8" completeness meter used on case cards. */
export function CaseProgress({ matched, expected, extra, size = "md" }: { matched: number; expected: number; extra: number; size?: "md" | "lg" }) {
  const complete = expected > 0 && matched === expected && extra === 0;
  const pct = expected ? Math.min(100, Math.round((matched / expected) * 100)) : 0;
  return (
    <div>
      <div className={cn("font-semibold tabular-nums", size === "lg" ? "text-3xl" : "text-lg", complete ? "text-ok" : expected ? "text-warn" : "text-text")}>
        {matched}
        <span className="text-muted"> / {expected || "–"}</span>
        {extra > 0 && <span className="ml-2 text-sm font-medium text-danger">+{extra}</span>}
      </div>
      {expected > 0 && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div className={cn("h-full rounded-full", complete ? "bg-ok" : "bg-warn")} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

export function CaseList({ cases, showProject, emptyAction }: { cases: CaseSummary[]; showProject?: boolean; emptyAction?: React.ReactNode }) {
  if (cases.length === 0) {
    return (
      <EmptyState title="No cases yet" action={emptyAction}>
        Cases group equipment for transport and checks. Create them from a template or start empty.
      </EmptyState>
    );
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cases.map((c) => {
        const cmp = c.comparison;
        return (
          <li key={c.id}>
            <Link href={`/cases/${c.id}`} className="block h-full rounded-xl border border-border bg-surface p-4 hover:border-ring/60">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{c.name}</div>
                  <div className="truncate text-xs text-muted">{[c.code, showProject ? c.projectName : null].filter(Boolean).join(" · ") || " "}</div>
                </div>
                <CaseProgress matched={cmp.matchedTotal} expected={cmp.expectedTotal} extra={cmp.extraTotal} />
              </div>
              <p className={cn("mt-3 text-xs", cmp.complete ? "text-ok" : cmp.expectedTotal === 0 ? "text-muted" : "text-warn")}>
                {cmp.expectedTotal === 0
                  ? `${cmp.actualTotal} item${cmp.actualTotal === 1 ? "" : "s"} · no expected contents`
                  : cmp.complete
                    ? "Complete"
                    : [cmp.missingTotal > 0 && `${cmp.missingTotal} missing`, cmp.extraTotal > 0 && `${cmp.extraTotal} not expected`].filter(Boolean).join(" · ")}
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
