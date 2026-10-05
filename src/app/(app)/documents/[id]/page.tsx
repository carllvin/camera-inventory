import Link from "next/link";
import { CircleAlert, FileText, Loader2, Sparkles } from "lucide-react";
import { ActionForm, Field, Select, SubmitButton } from "@/components/forms";
import { Badge, Card, CardHeader, KeyValues, Mono, PageHeader } from "@/components/ui";
import { DOCUMENT_KIND_LABEL, DOCUMENT_STATUS_LABEL, formatDate, formatDateTime } from "@/lib/format";
import { getExtractor } from "@/server/ai";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { getDocumentReview, releaseStaleExtractions } from "@/server/domain/documents";
import { listEquipmentTypeOptions } from "@/server/domain/equipment-types";
import { listProjectOptions } from "@/server/domain/projects";
import { listRentalHouses } from "@/server/domain/rental-houses";
import { assertUuid, orNotFound } from "@/server/pages";
import {
  addLineAction,
  confirmDeliveryAction,
  discardDocumentAction,
  removeLineAction,
  retryExtractionAction,
  updateHeaderAction,
  updateLineAction,
} from "../actions";
import { RESOLUTION } from "../resolution";
import { AddLineCard, AutoRefresh, ConfirmButton, LineCard } from "../review";

const STATUS_TONE: Record<string, "ok" | "accent" | "danger" | "neutral" | "info"> = {
  confirmed: "ok",
  extracted: "accent",
  uploaded: "accent",
  processing: "info",
  failed: "danger",
  discarded: "neutral",
};

function Files({ files }: { files: { id: string; fileName: string; mimeType: string }[] }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Original" />
      <div className="space-y-3 p-3">
        {files.map((f) =>
          f.mimeType === "application/pdf" ? (
            <div key={f.id}>
              <iframe src={`/api/documents/files/${f.id}`} title={f.fileName} className="hidden h-[70vh] w-full rounded-lg border border-border bg-white lg:block" />
              <a href={`/api/documents/files/${f.id}`} target="_blank" rel="noopener" className="flex items-center gap-2 text-sm text-accent hover:underline lg:mt-2">
                <FileText className="size-4" /> {f.fileName}
              </a>
            </div>
          ) : (
            <a key={f.id} href={`/api/documents/files/${f.id}`} target="_blank" rel="noopener" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked file */}
              <img src={`/api/documents/files/${f.id}`} alt={f.fileName} loading="lazy" className="w-full rounded-lg border border-border bg-white" />
            </a>
          ),
        )}
      </div>
    </Card>
  );
}

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  assertUuid(id);
  const ctx = await getCtx();
  const db = getDb();
  await releaseStaleExtractions(db);
  const d = await orNotFound(getDocumentReview(db, ctx, id));
  const { doc } = d;
  const canEdit = hasRole(ctx, "member");
  const editable = canEdit && (doc.status === "uploaded" || doc.status === "extracted" || doc.status === "failed");
  const aiAvailable = getExtractor().available;
  const [types, projects, houses] = editable
    ? await Promise.all([listEquipmentTypeOptions(db, ctx), listProjectOptions(db, ctx, { activeOnly: true }), listRentalHouses(db, ctx)])
    : [[], [], []];
  const typeOptions = types.map((t) => ({ value: t.id, label: t.name }));
  const receiveCount = d.lines.filter((l) => l.resolution === "create_new" || l.resolution === "match_existing").reduce((n, l) => n + l.quantity, 0);

  return (
    <>
      {doc.status === "processing" && <AutoRefresh />}
      <PageHeader
        back={{ href: doc.projectId ? `/projects/${doc.projectId}/documents` : "/documents", label: d.projectName ?? "Documents" }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {DOCUMENT_KIND_LABEL[doc.kind]} {doc.documentNumber && <Mono>{doc.documentNumber}</Mono>}
            <Badge tone={STATUS_TONE[doc.status]}>{DOCUMENT_STATUS_LABEL[doc.status] === "Uploaded" ? "Enter lines" : DOCUMENT_STATUS_LABEL[doc.status]}</Badge>
          </span>
        }
        subtitle={[d.rentalHouseName, d.projectName, doc.documentDate && formatDate(doc.documentDate), d.uploadedBy && `uploaded by ${d.uploadedBy}`].filter(Boolean).join(" · ")}
      />

      {d.duplicate && doc.status !== "confirmed" && (
        <p className="mb-4 flex items-start gap-2 rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            This looks like a document that was already uploaded ({d.duplicate.documentNumber ?? "same file"}, {DOCUMENT_STATUS_LABEL[d.duplicate.status]?.toLowerCase()}).{" "}
            <Link href={`/documents/${d.duplicate.id}`} className="font-medium underline">
              Open it
            </Link>{" "}
            and discard this one if it is the same delivery.
          </span>
        </p>
      )}

      {doc.status === "processing" && (
        <Card className="mb-6 flex items-center gap-3 p-5">
          <Loader2 className="size-5 animate-spin text-accent" />
          <div>
            <div className="font-medium">Reading the document…</div>
            <div className="text-sm text-muted">Usually 20–60 seconds. You can leave this page; nothing changes until you confirm.</div>
          </div>
        </Card>
      )}

      {doc.status === "failed" && (
        <Card className="mb-6 p-4">
          <p className="text-sm text-danger">{doc.extractionError ?? "Reading the document failed."}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {canEdit && aiAvailable && (
              <ActionForm action={retryExtractionAction.bind(null, id)}>
                <SubmitButton variant="secondary" pendingText="Starting…">
                  <Sparkles className="size-4" /> Read again
                </SubmitButton>
              </ActionForm>
            )}
            <span className="self-center text-sm text-muted">or add the lines by hand below.</span>
          </div>
        </Card>
      )}

      {d.warnings.length > 0 && doc.status !== "confirmed" && (
        <Card className="mb-6 p-4">
          <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-warn">
            <Sparkles className="size-4" /> Notes from the AI reading
          </h2>
          <ul className="list-inside list-disc text-sm text-muted">
            {d.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Card>
      )}

      <div className={d.files.length > 0 ? "grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]" : "max-w-3xl"}>
        <div className="min-w-0 space-y-4">
          {editable ? (
            <>
              <Card className="p-4">
                <ActionForm action={updateHeaderAction.bind(null, id)} className="grid gap-3 sm:grid-cols-2">
                  <Select label="Project" name="projectId" id="h-project" defaultValue={doc.projectId} options={projects.map((p) => ({ value: p.id, label: p.name }))} />
                  <Select label="Rental house" name="rentalHouseId" id="h-rh" placeholder="Choose…" defaultValue={doc.rentalHouseId} options={houses.map((h) => ({ value: h.id, label: h.name }))} />
                  <Field label="Document number" name="documentNumber" id="h-number" defaultValue={doc.documentNumber} spellCheck={false} />
                  <Field label="Date" name="documentDate" id="h-date" type="date" defaultValue={doc.documentDate} />
                  <div className="sm:col-span-2">
                    <SubmitButton variant="secondary">Save details</SubmitButton>
                  </div>
                </ActionForm>
              </Card>

              <div className="flex flex-wrap gap-2 text-xs">
                {(["create_new", "match_existing", "pending", "discrepancy", "ignore"] as const).map((k) => {
                  const n = d.lines.filter((l) => l.resolution === k).length;
                  return n ? (
                    <Badge key={k} tone={RESOLUTION[k]!.tone}>
                      {n} × {RESOLUTION[k]!.label}
                    </Badge>
                  ) : null;
                })}
              </div>

              <ul className="space-y-2">
                {d.lines.map((l) => (
                  <LineCard
                    key={`${l.id}-${l.resolution}-${l.matchedEquipmentTypeId}-${l.serialNumber}`}
                    types={typeOptions}
                    line={{ ...l, updateAction: updateLineAction.bind(null, id, l.id), removeAction: removeLineAction.bind(null, id, l.id) }}
                  />
                ))}
              </ul>
              <AddLineCard action={addLineAction.bind(null, id)} types={typeOptions} />

              <Card className="space-y-3 p-4">
                {d.blockers.length > 0 ? (
                  <ul className="space-y-1 text-sm text-warn">
                    {d.blockers.slice(0, 6).map((b, i) => (
                      <li key={i}>• {b.message}</li>
                    ))}
                    {d.blockers.length > 6 && <li>… and {d.blockers.length - 6} more</li>}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">
                    Confirming puts {receiveCount} item{receiveCount === 1 ? "" : "s"} on {d.projectName}: {d.counts.existing} known, the rest created new. Every change is recorded in the history.
                  </p>
                )}
                <ConfirmButton action={confirmDeliveryAction.bind(null, id)} disabled={d.blockers.length > 0} count={receiveCount} />
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted">Discard this document</summary>
                  <ActionForm action={discardDocumentAction.bind(null, id)} className="mt-2 flex items-end gap-2">
                    <Field name="reason" id="discard-reason" placeholder="Reason (e.g. uploaded twice)" aria-label="Reason" className="flex-1" />
                    <SubmitButton variant="danger">Discard</SubmitButton>
                  </ActionForm>
                </details>
              </Card>
            </>
          ) : (
            doc.status !== "processing" && (
              <>
                <Card className="p-4">
                  <KeyValues
                    items={[
                      { label: "Rental house", value: d.rentalHouseName },
                      { label: "Project", value: doc.projectId ? <Link className="hover:underline" href={`/projects/${doc.projectId}`}>{d.projectName}</Link> : null },
                      { label: "Document date", value: formatDate(doc.documentDate) },
                      { label: "Read by", value: doc.extractionModel ? `${doc.extractionProvider} (${doc.extractionModel})` : "entered manually" },
                      { label: "Confirmed", value: doc.confirmedAt ? formatDateTime(doc.confirmedAt) : "Not yet" },
                    ]}
                  />
                </Card>
                <div className="overflow-x-auto rounded-xl border border-border bg-surface">
                  <table className="w-full min-w-[36rem] text-sm">
                    <thead className="border-b border-border bg-surface-2/60 text-left text-xs text-muted">
                      <tr>
                        <th className="px-4 py-2 font-medium">#</th>
                        <th className="px-3 py-2 font-medium">On document</th>
                        <th className="px-3 py-2 text-right font-medium">Qty</th>
                        <th className="px-3 py-2 font-medium">Serial / asset</th>
                        <th className="px-3 py-2 font-medium">Equipment</th>
                        <th className="px-3 py-2 font-medium">Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {d.lines.map((l) => (
                        <tr key={l.id}>
                          <td className="px-4 py-2 text-muted tabular-nums">{l.lineNumber}</td>
                          <td className="px-3 py-2">{l.description}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{l.quantity}</td>
                          <td className="px-3 py-2">
                            <Mono>{[l.serialNumber, l.assetNumber].filter(Boolean).join(" · ") || "—"}</Mono>
                          </td>
                          <td className="px-3 py-2">
                            {l.matchedEquipmentItemId ? (
                              <Link href={`/equipment/${l.matchedEquipmentItemId}`} className="hover:underline">
                                {l.typeName}
                              </Link>
                            ) : (
                              (l.typeName ?? <span className="text-muted">—</span>)
                            )}
                            {l.matchReason && doc.status !== "confirmed" && <div className="text-xs text-muted">{l.matchReason}</div>}
                          </td>
                          <td className="px-3 py-2">
                            <Badge tone={RESOLUTION[l.resolution]?.tone}>{doc.status === "confirmed" && l.resolution === "create_new" ? "Created" : RESOLUTION[l.resolution]?.label}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
          )}
        </div>
        {d.files.length > 0 && (
          <div className="min-w-0 lg:sticky lg:top-20 lg:self-start">
            <Files files={d.files} />
          </div>
        )}
      </div>
    </>
  );
}
