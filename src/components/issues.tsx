import Link from "next/link";
import { ISSUE_TYPE_LABEL } from "@/lib/format";
import { getFormat, getT, getTranslateMessage } from "@/server/i18n";
import { Badge } from "./ui";

export interface IssueRow {
  id: string;
  type: string;
  status: string;
  severity: string;
  title: string;
  description: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  resolution: string | null;
  projectId: string | null;
  projectName: string | null;
  equipmentItemId: string | null;
}

const SEVERITY_TONE = { critical: "danger", high: "danger", medium: "warn", low: "neutral" } as const;

export async function IssueList({ issues, compact, showProject = true }: { issues: IssueRow[]; compact?: boolean; showProject?: boolean }) {
  const [t, f, tm] = await Promise.all([getT(), getFormat(), getTranslateMessage()]);
  if (issues.length === 0) return <p className="px-4 py-6 text-sm text-muted">{t("No issues.")}</p>;
  return (
    <ul className="divide-y divide-border">
      {issues.map((i) => {
        const resolved = i.status === "resolved" || i.status === "dismissed";
        return (
          <li key={i.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={resolved ? "neutral" : SEVERITY_TONE[i.severity as keyof typeof SEVERITY_TONE]}>{ISSUE_TYPE_LABEL[i.type] ? t(ISSUE_TYPE_LABEL[i.type]!) : i.type}</Badge>
              {resolved && <Badge tone="ok">{i.status === "resolved" ? t("Resolved") : t("Dismissed")}</Badge>}
              <span className="text-xs text-muted">{f.formatDate(i.createdAt)}</span>
            </div>
            <p className={`mt-1 text-sm ${resolved ? "text-muted" : "font-medium"}`}>
              {i.equipmentItemId ? (
                <Link href={`/equipment/${i.equipmentItemId}`} className="hover:underline">
                  {tm(i.title)}
                </Link>
              ) : (
                i.title
              )}
            </p>
            {!compact && i.description && <p className="mt-0.5 text-sm text-muted">{i.description}</p>}
            {!compact && i.resolution && <p className="mt-1 text-sm text-ok">{t("Resolution: {resolution}", { resolution: i.resolution })}</p>}
            {showProject && i.projectId && (
              <Link href={`/projects/${i.projectId}`} className="mt-0.5 block text-xs text-muted hover:underline">
                {i.projectName}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
