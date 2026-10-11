import Link from "next/link";
import { DOCUMENT_KIND_LABEL, DOCUMENT_STATUS_LABEL } from "@/lib/format";
import { getFormat, getT } from "@/server/i18n";
import { Badge, EmptyState, Mono } from "./ui";

export interface DocumentRow {
  id: string;
  kind: string;
  status: string;
  documentNumber: string | null;
  documentDate: string | null;
  projectId: string | null;
  projectName: string | null;
  rentalHouseName: string | null;
  lineCount: number;
}

export async function DocumentList({ documents, showProject = true }: { documents: DocumentRow[]; showProject?: boolean }) {
  const [t, f] = await Promise.all([getT(), getFormat()]);
  if (documents.length === 0) return <EmptyState title={t("No documents yet")}>{t("Delivery and return notes will appear here.")}</EmptyState>;
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
      {documents.map((d) => (
        <li key={d.id}>
          <Link href={`/documents/${d.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{DOCUMENT_KIND_LABEL[d.kind] && t(DOCUMENT_KIND_LABEL[d.kind]!)}</span>
                <Mono>{d.documentNumber ?? "—"}</Mono>
                <Badge tone={d.status === "confirmed" ? "ok" : d.status === "extracted" ? "accent" : d.status === "failed" ? "danger" : "neutral"}>
                  {DOCUMENT_STATUS_LABEL[d.status] && t(DOCUMENT_STATUS_LABEL[d.status]!)}
                </Badge>
              </div>
              <div className="text-xs text-muted">
                {[d.rentalHouseName, showProject ? (d.projectName ?? t("project not set")) : null, t("{n} lines", { n: d.lineCount })].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div className="text-xs text-muted">{f.formatDate(d.documentDate)}</div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
