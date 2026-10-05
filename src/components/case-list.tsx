import { Card, EmptyState } from "./ui";
import { cn } from "@/lib/format";

export interface CaseRow {
  id: string;
  name: string;
  code: string | null;
  project_id: string;
  project_name: string;
  template_name: string | null;
  actual: number;
  expected: number;
}

/** Cases with "7 / 8" completeness. */
export function CaseList({ cases, showProject }: { cases: CaseRow[]; showProject?: boolean }) {
  if (cases.length === 0) return <EmptyState title="No cases yet">Cases and case templates are set up per project.</EmptyState>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cases.map((c) => {
        const complete = c.expected > 0 && c.actual === c.expected;
        const over = c.actual > c.expected && c.expected > 0;
        const pct = c.expected ? Math.min(100, Math.round((c.actual / c.expected) * 100)) : 0;
        return (
          <li key={c.id}>
            <Card className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{c.name}</div>
                  <div className="text-xs text-muted">
                    {[c.code, showProject ? c.project_name : null, c.template_name && `Template: ${c.template_name}`].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className={cn("text-lg font-semibold tabular-nums", complete ? "text-ok" : "text-warn")}>
                  {c.actual}
                  <span className="text-muted"> / {c.expected || "–"}</span>
                </div>
              </div>
              {c.expected > 0 && (
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                  <div className={cn("h-full rounded-full", complete ? "bg-ok" : over ? "bg-danger" : "bg-warn")} style={{ width: `${pct}%` }} />
                </div>
              )}
              {!complete && c.expected > 0 && (
                <p className="mt-2 text-xs text-warn">
                  {over ? `${c.actual - c.expected} more than expected` : `${c.expected - c.actual} expected item${c.expected - c.actual === 1 ? "" : "s"} not in case`}
                </p>
              )}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
