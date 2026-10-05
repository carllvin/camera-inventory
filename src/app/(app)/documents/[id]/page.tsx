import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, KeyValues, Mono, PageHeader } from "@/components/ui";
import { DOCUMENT_KIND_LABEL, DOCUMENT_STATUS_LABEL, formatDate, formatDateTime } from "@/lib/format";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { getDocument } from "@/server/domain/overview";
import { assertUuid } from "@/server/pages";

const RESOLUTION: Record<string, { label: string; tone: "neutral" | "ok" | "accent" | "warn" | "danger" }> = {
  pending: { label: "Needs review", tone: "accent" },
  match_existing: { label: "Matched", tone: "ok" },
  create_new: { label: "Created", tone: "ok" },
  ignore: { label: "Ignored", tone: "neutral" },
  discrepancy: { label: "Discrepancy", tone: "danger" },
};

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  assertUuid(id);
  const d = await getDocument(getDb(), await getCtx(), id);
  if (!d) notFound();
  const { doc } = d;
  return (
    <>
      <PageHeader
        back={{ href: doc.projectId ? `/projects/${doc.projectId}/documents` : "/documents", label: "Documents" }}
        title={
          <span className="flex items-center gap-2">
            {DOCUMENT_KIND_LABEL[doc.kind]} <Mono>{doc.documentNumber ?? ""}</Mono>
          </span>
        }
        subtitle={<Badge tone={doc.status === "confirmed" ? "ok" : "accent"}>{DOCUMENT_STATUS_LABEL[doc.status]}</Badge>}
      />
      <Card className="mb-6 max-w-2xl p-4">
        <KeyValues
          items={[
            { label: "Rental house", value: d.rentalHouseName },
            { label: "Project", value: doc.projectId ? <Link className="hover:underline" href={`/projects/${doc.projectId}`}>{d.projectName}</Link> : null },
            { label: "Document date", value: formatDate(doc.documentDate) },
            { label: "Read by", value: doc.extractionProvider ? `${doc.extractionProvider} (${doc.extractionModel ?? "?"})` : null },
            { label: "Confirmed", value: doc.confirmedAt ? formatDateTime(doc.confirmedAt) : "Not yet" },
          ]}
        />
      </Card>
      {doc.status === "extracted" && (
        <p className="mb-4 max-w-2xl rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">
          This document has been read but not confirmed. Nothing on the project changes until it is reviewed and confirmed.
        </p>
      )}
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="border-b border-border bg-surface-2/60 text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">On document</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 font-medium">Serial / asset</th>
              <th className="px-3 py-2 font-medium">Matched to</th>
              <th className="px-3 py-2 font-medium">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {d.lines.map(({ line, typeName }) => (
              <tr key={line.id}>
                <td className="px-4 py-2 text-muted tabular-nums">{line.lineNumber}</td>
                <td className="px-3 py-2">{line.description}</td>
                <td className="px-3 py-2 text-right tabular-nums">{line.quantity}</td>
                <td className="px-3 py-2">
                  <Mono>{[line.serialNumber, line.assetNumber].filter(Boolean).join(" · ") || "—"}</Mono>
                </td>
                <td className="px-3 py-2">
                  {line.matchedEquipmentItemId ? (
                    <Link href={`/equipment/${line.matchedEquipmentItemId}`} className="hover:underline">
                      {typeName}
                    </Link>
                  ) : (
                    (typeName ?? <span className="text-muted">—</span>)
                  )}
                  {line.matchReason && <div className="text-xs text-muted">{line.matchReason}</div>}
                </td>
                <td className="px-3 py-2">
                  <Badge tone={RESOLUTION[line.resolution]?.tone}>{RESOLUTION[line.resolution]?.label}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
