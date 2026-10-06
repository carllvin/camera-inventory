import Link from "next/link";
import { CircleAlert, FileText, Loader2, Sparkles } from "lucide-react";
import { ActionForm, Field, Select, SubmitButton } from "@/components/forms";
import { Badge, Card, CardHeader, KeyValues, Mono, PageHeader } from "@/components/ui";
import { DOCUMENT_KIND_LABEL, DOCUMENT_STATUS_LABEL, formatDate, formatDateTime } from "@/lib/format";
import { getExtractor } from "@/server/ai";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { getDocumentReview, listReturnableItems, releaseStaleExtractions } from "@/server/domain/documents";
import { listProjectOptions } from "@/server/domain/projects";
import { listRentalHouses } from "@/server/domain/rental-houses";
import { assertUuid, orNotFound } from "@/server/pages";
import {
  addLineAction,
  confirmDeliveryAction,
  confirmReturnAction,
  createProjectFromDocumentAction,
  discardDocumentAction,
  removeLineAction,
  reportLineIssueAction,
  retryExtractionAction,
  updateHeaderAction,
  updateLineAction,
} from "../actions";
import { RESOLUTION, RETURN_RESOLUTION } from "../resolution";
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

type Review = Awaited<ReturnType<typeof getDocumentReview>>;

/** What the document says about the production, what was detected, and "create project" when it is new. */
function ProjectPanel({ id, d }: { id: string; d: Review }) {
  const { doc, projectHints: hints } = d;
  const printed = hints ? [hints.title, hints.number && `project no. ${hints.number}`, hints.customer].filter(Boolean).join(" · ") : null;
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold">Project</h2>
      {printed && (
        <p className="mt-1 text-sm text-muted">
          On the document: <span className="text-text">{printed}</span>
        </p>
      )}
      {doc.projectId && d.projectDetection && (
        <p className="mt-2 text-sm text-ok">
          Detected: <span className="font-medium">{d.projectName}</span> ({d.projectDetection.how}). Change it below if it is wrong.
        </p>
      )}
      {doc.projectId && !d.projectDetection && !d.projectMismatch && (
        <p className="mt-2 text-sm text-ok">
          Using project <span className="font-medium">{d.projectName}</span>.
        </p>
      )}
      {d.projectMismatch && (
        <p className="mt-2 flex items-start gap-1.5 text-sm text-warn">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            This document looks like it is for{" "}
            <Link href={`/projects/${d.projectMismatch.id}`} className="font-medium underline">
              {d.projectMismatch.name}
            </Link>
            , not {d.projectName}. Check the project below.
          </span>
        </p>
      )}
      {!doc.projectId && (
        <>
          <p className="mt-2 text-sm text-warn">{hints ? "No matching project found. Choose one below, or create it from the document." : "Choose the project below."}</p>
          <details className="mt-3" open={Boolean(hints?.title)}>
            <summary className="cursor-pointer text-sm font-medium text-accent">Create project{hints?.title ? ` “${hints.title}”` : ""}</summary>
            <ActionForm action={createProjectFromDocumentAction.bind(null, id)} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Name" name="name" id="np-name" defaultValue={hints?.title} required />
              <Field label="Code" name="code" id="np-code" placeholder="Short code (optional)" />
              <Field label="Production company" name="productionCompany" id="np-company" defaultValue={hints?.customer} className="sm:col-span-2" />
              <Field label="Start" name="startDate" id="np-start" type="date" defaultValue={hints?.startDate} />
              <Field label="End" name="endDate" id="np-end" type="date" defaultValue={hints?.endDate} />
              <div className="sm:col-span-2">
                <SubmitButton pendingText="Creating…">Create project and use it</SubmitButton>
              </div>
            </ActionForm>
          </details>
        </>
      )}
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
  const [projects, houses] = editable ? await Promise.all([listProjectOptions(db, ctx, { activeOnly: true }), listRentalHouses(db, ctx)]) : [[], []];
  const isReturn = doc.kind === "return_note";
  const mode = isReturn ? ("return" as const) : ("delivery" as const);
  const itemOptions = editable && isReturn && doc.projectId ? (await listReturnableItems(db, ctx, doc.projectId)).map((i) => ({ value: i.id, label: i.label })) : [];
  const labels = isReturn ? RETURN_RESOLUTION : RESOLUTION;
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

      {d.outcome && (
        <p role="status" className="mb-4 rounded-lg bg-ok/10 px-3 py-2 text-sm text-ok">
          {d.outcome.summary}
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
              {(d.projectHints || !doc.projectId) && <ProjectPanel id={id} d={d} />}
              <Card className="p-4">
                <ActionForm action={updateHeaderAction.bind(null, id)} className="grid gap-3 sm:grid-cols-2">
                  <Select label="Project" name="projectId" id="h-project" placeholder="Choose…" defaultValue={doc.projectId} options={projects.map((p) => ({ value: p.id, label: p.name }))} />
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
                    <Badge key={k} tone={labels[k]!.tone}>
                      {n} × {labels[k]!.label}
                    </Badge>
                  ) : null;
                })}
              </div>

              <ul className="space-y-2">
                {d.lines.map((l) => (
                  <LineCard
                    key={`${l.id}-${l.resolution}-${l.matchedEquipmentTypeId}-${l.matchedEquipmentItemId}-${l.serialNumber}`}
                    items={itemOptions}
                    mode={mode}
                    line={{
                      ...l,
                      updateAction: updateLineAction.bind(null, id, l.id),
                      removeAction: removeLineAction.bind(null, id, l.id),
                      reportAction: reportLineIssueAction.bind(null, id, l.id),
                    }}
                  />
                ))}
              </ul>
              <AddLineCard action={addLineAction.bind(null, id)} items={itemOptions} mode={mode} />

              {d.returnOverview && (
                <Card className="p-4">
                  <h2 className="text-sm font-semibold">After this return</h2>
                  <p className="mt-1 text-sm text-muted">
                    {d.returnOverview.returning} going back to {d.rentalHouseName ?? "the rental house"} ·{" "}
                    <span className={d.returnOverview.staying.length ? "font-medium text-text" : ""}>
                      {d.returnOverview.staying.reduce((n, i) => n + i.units, 0)} stay on the project
                    </span>
                    {d.returnOverview.staying.length > 0 && " (partial return — that is fine)"}
                  </p>
                  {d.returnOverview.staying.length > 0 && (
                    <ul className="mt-2 max-h-56 space-y-0.5 overflow-y-auto text-sm">
                      {d.returnOverview.staying.map((i) => (
                        <li key={i.id} className="flex justify-between gap-2">
                          <Link href={`/equipment/${i.id}`} className="truncate hover:underline">
                            {i.label}
                          </Link>
                          {i.units > 1 && <span className="text-muted tabular-nums">× {i.units}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}

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
                    {isReturn
                      ? `Confirming marks ${receiveCount} item${receiveCount === 1 ? "" : "s"} as returned and takes them off ${d.projectName}. Every change is recorded in the history.`
                      : `Confirming puts ${receiveCount} item${receiveCount === 1 ? "" : "s"} on ${d.projectName}: ${d.counts.existing} known, the rest created new. Every change is recorded in the history.`}
                  </p>
                )}
                <ConfirmButton
                  action={(isReturn ? confirmReturnAction : confirmDeliveryAction).bind(null, id)}
                  disabled={d.blockers.length > 0}
                  count={receiveCount}
                  mode={mode}
                />
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
                            <Badge tone={labels[l.resolution]?.tone}>
                              {doc.status === "confirmed" && l.resolution === "create_new" ? "Created" : doc.status === "confirmed" && isReturn && l.resolution === "match_existing" ? "Returned" : labels[l.resolution]?.label}
                            </Badge>
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
