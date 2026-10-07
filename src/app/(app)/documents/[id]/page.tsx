import Link from "next/link";
import { CircleAlert, FileText, Loader2, Sparkles } from "lucide-react";
import { ActionForm, Field, Select, SubmitButton } from "@/components/forms";
import { Badge, Card, CardHeader, KeyValues, Mono, PageHeader } from "@/components/ui";
import { DOCUMENT_KIND_LABEL, DOCUMENT_STATUS_LABEL, formatDate, formatDateTime } from "@/lib/format";
import { getExtractor } from "@/server/ai";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { getCategoryTree } from "@/server/domain/categories";
import { suggestedSets } from "@/server/domain/document-sets";
import { getConsolidation } from "@/server/domain/consolidate";
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
  createTypeFromLineAction,
  createSetFromDocumentAction,
  createAllSetsFromDocumentAction,
  addFromListAction,
  removeNotOnListAction,
  finishListAction,
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
  const isList = doc.kind === "inventory_list";
  const consolidation = isList && editable ? await getConsolidation(db, ctx, id) : null;
  const mode = isReturn ? ("return" as const) : ("delivery" as const);
  const setSuggestions = !isReturn && doc.status === "confirmed" ? await suggestedSets(db, ctx.workspaceId, id) : [];
  const canCreateSets = hasRole(ctx, "member");
  const itemOptions = editable && isReturn && doc.projectId ? (await listReturnableItems(db, ctx, doc.projectId, doc.id)).map((i) => ({ value: i.id, label: i.label })) : [];
  // Unknown products on a delivery note: a pre-filled "create" strip per line.
  const unknown = editable && !isReturn ? d.lines.filter((l) => l.resolution === "pending" && !l.matchedEquipmentTypeId) : [];
  const categoryTree = unknown.length ? (await getCategoryTree(db, ctx)).flat : [];
  const categoryOptions = categoryTree.map((c) => ({ value: c.id, label: `${"  ".repeat(c.depth)}${c.name}` }));
  const categoryByPath = new Map(
    categoryTree.map((c) => {
      const parent = categoryTree.find((p) => p.id === c.parentId);
      return [(parent ? `${parent.name} › ${c.name}` : c.name).toLowerCase(), c.id] as const;
    }),
  );
  const draftFor = (l: (typeof d.lines)[number]) => {
    const words = l.description.trim().split(/\s+/);
    const manufacturer = l.manufacturer ?? (words.length > 1 ? words[0]! : "");
    const model = l.model ?? (words.length > 1 ? words.slice(1).join(" ") : l.description);
    const tracking = l.suggestedTracking === "bulk" || l.suggestedTracking === "serialized" ? l.suggestedTracking : !l.serialNumber && l.quantity > 1 ? "bulk" : "serialized";
    return {
      action: createTypeFromLineAction.bind(null, id, l.id),
      manufacturer,
      model,
      categoryId: (l.suggestedCategory && categoryByPath.get(l.suggestedCategory.toLowerCase())) || null,
      tracking: tracking as "serialized" | "bulk",
      categories: categoryOptions,
      byAi: Boolean(l.suggestedCategory || l.suggestedTracking),
    };
  };
  const labels = isReturn ? RETURN_RESOLUTION : RESOLUTION;
  const receiveCount = d.lines.filter((l) => l.resolution === "create_new" || l.resolution === "match_existing").reduce((n, l) => n + l.quantity, 0);
  const alreadyRemoved = d.returnOverview?.removed.reduce((n, r) => n + Math.min(r.onNote, r.units), 0) ?? 0;

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

      {setSuggestions.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="Sets on this note" />
          <p className="px-4 pt-3 text-sm text-muted">
            The note groups these items into sets. Create them in one click: packed, with exactly these contents expected.
          </p>
          <ul className="divide-y divide-border">
            {setSuggestions.map((sg) => (
              <li key={sg.name} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{sg.name}</div>
                  <div className="text-xs text-muted">
                    {sg.units} piece{sg.units === 1 ? "" : "s"} from {sg.lines} line{sg.lines === 1 ? "" : "s"}
                  </div>
                </div>
                {sg.existing ? (
                  <Link href={`/sets/${sg.existing.id}`} className="text-sm text-accent hover:underline">
                    Open {sg.existing.name}
                  </Link>
                ) : (
                  canCreateSets && (
                    <ActionForm action={createSetFromDocumentAction.bind(null, id, sg.name)}>
                      <SubmitButton variant="secondary" pendingText="…">
                        Create set
                      </SubmitButton>
                    </ActionForm>
                  )
                )}
              </li>
            ))}
          </ul>
          {canCreateSets && setSuggestions.filter((sg) => !sg.existing).length > 1 && (
            <ActionForm action={createAllSetsFromDocumentAction.bind(null, id, setSuggestions.filter((sg) => !sg.existing).map((sg) => sg.name))} className="border-t border-border px-4 py-3">
              <SubmitButton pendingText="Creating…">Create all {setSuggestions.filter((sg) => !sg.existing).length} sets</SubmitButton>
            </ActionForm>
          )}
        </Card>
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

              {!isReturn && new Set(d.lines.map((l) => l.setName).filter(Boolean)).size > 0 && (
                <p className="text-sm text-muted">
                  ▣ The note groups items into {new Set(d.lines.map((l) => l.setName).filter(Boolean)).size} set(s). After confirming you can create them in one click.
                </p>
              )}
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
                      newType: unknown.includes(l) ? draftFor(l) : undefined,
                    }}
                  />
                ))}
              </ul>
              <AddLineCard action={addLineAction.bind(null, id)} items={itemOptions} mode={mode} />

              {d.returnOverview && d.returnOverview.removed.length > 0 && (
                <Card className="p-4">
                  <h2 className="text-sm font-semibold">Double check: removed with this note</h2>
                  <p className="mt-1 text-sm text-muted">
                    {d.returnOverview.removed.filter((r) => r.onNote >= r.units).length} of {d.returnOverview.removed.length} found on the note.
                    {d.returnOverview.removed.some((r) => r.onNote < r.units) && " Check the ones marked — they were removed but the note does not list them."}
                  </p>
                  <ul className="mt-2 max-h-56 space-y-0.5 overflow-y-auto text-sm">
                    {d.returnOverview.removed.map((r) => (
                      <li key={r.id} className="flex justify-between gap-2">
                        <Link href={`/equipment/${r.id}`} className="truncate hover:underline">
                          {r.label}
                        </Link>
                        {r.onNote >= r.units ? (
                          <span className="text-ok">✓ on note</span>
                        ) : (
                          <span className="text-warn">{r.onNote > 0 ? `${r.onNote} of ${r.units} on note` : "not on note"}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

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

              {consolidation && (
                <Card>
                  <CardHeader title="Compared with the database" />
                  {!doc.projectId || !doc.rentalHouseId ? (
                    <p className="px-4 py-3 text-sm text-warn">Choose the project and the rental house above to compare.</p>
                  ) : (
                    <div className="divide-y divide-border">
                      <section className="px-4 py-3">
                        <h3 className="text-sm font-medium text-ok">✓ On the list and in the database ({consolidation.present.reduce((n, x) => n + x.units, 0)})</h3>
                        {consolidation.present.length > 0 && (
                          <details className="mt-1 text-sm text-muted">
                            <summary className="cursor-pointer">Show</summary>
                            <ul className="mt-1 space-y-0.5">
                              {consolidation.present.map((x) => (
                                <li key={`${x.lineId}-${x.label}`}>{x.label}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </section>
                      <section className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-sm font-medium text-warn">On the list, missing in the database ({consolidation.missing.reduce((n, x) => n + x.units, 0)})</h3>
                          {consolidation.missing.filter((m) => m.canAdd).length > 1 && (
                            <ActionForm action={addFromListAction.bind(null, id, "all")}>
                              <SubmitButton variant="secondary" className="!px-2.5 !py-1 text-xs" pendingText="…">
                                Add all
                              </SubmitButton>
                            </ActionForm>
                          )}
                        </div>
                        {consolidation.missing.length === 0 ? (
                          <p className="mt-1 text-sm text-muted">Nothing.</p>
                        ) : (
                          <ul className="mt-1 divide-y divide-border">
                            {consolidation.missing.map((m) => (
                              <li key={`${m.lineId}-${m.label}`} className="flex items-center gap-2 py-1.5">
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm">{m.label}</div>
                                  {m.reason && <div className="text-xs text-warn">{m.reason}</div>}
                                </div>
                                {m.canAdd && (
                                  <ActionForm action={addFromListAction.bind(null, id, m.lineId)}>
                                    <SubmitButton variant="secondary" className="!px-2.5 !py-1 text-xs" pendingText="…">
                                      Add
                                    </SubmitButton>
                                  </ActionForm>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                      <section className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-sm font-medium text-danger">In the database, not on the list ({consolidation.extra.reduce((n, x) => n + x.units, 0)})</h3>
                          {consolidation.extra.length > 1 && (
                            <ActionForm action={removeNotOnListAction.bind(null, id, "all")}>
                              <SubmitButton variant="secondary" className="!px-2.5 !py-1 text-xs" pendingText="…">
                                Remove all
                              </SubmitButton>
                            </ActionForm>
                          )}
                        </div>
                        {consolidation.extra.length === 0 ? (
                          <p className="mt-1 text-sm text-muted">Nothing.</p>
                        ) : (
                          <ul className="mt-1 divide-y divide-border">
                            {consolidation.extra.map((x) => (
                              <li key={x.itemId} className="flex items-center gap-2 py-1.5">
                                <Link href={`/equipment/${x.itemId}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
                                  {x.label}
                                </Link>
                                <ActionForm action={removeNotOnListAction.bind(null, id, x.itemId)}>
                                  <SubmitButton variant="ghost" className="!px-2.5 !py-1 text-xs text-muted hover:text-danger" pendingText="…">
                                    Remove
                                  </SubmitButton>
                                </ActionForm>
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="mt-2 text-xs text-muted">Removing records the item as returned, with this list as the reason. Nothing is deleted; it can be undone from the history.</p>
                      </section>
                    </div>
                  )}
                </Card>
              )}

              <Card className="space-y-3 p-4">
                {isList ? (
                  <>
                    <p className="text-sm text-muted">When the differences are sorted out, close the list. It stays as a record of the check.</p>
                    <ActionForm action={finishListAction.bind(null, id)}>
                      <SubmitButton disabled={!doc.projectId || !doc.rentalHouseId}>Close the list</SubmitButton>
                    </ActionForm>
                  </>
                ) : d.blockers.length > 0 ? (
                  <ul className="space-y-1 text-sm text-warn">
                    {d.blockers.slice(0, 6).map((b, i) => (
                      <li key={i}>• {b.message}</li>
                    ))}
                    {d.blockers.length > 6 && <li>… and {d.blockers.length - 6} more</li>}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">
                    {isReturn
                      ? alreadyRemoved > 0
                        ? `Confirming records the note: ${alreadyRemoved} already removed item${alreadyRemoved === 1 ? "" : "s"} confirmed${receiveCount - alreadyRemoved > 0 ? `, ${receiveCount - alreadyRemoved} more taken off ${d.projectName} as returned` : ""}. Every change is recorded in the history.`
                        : `Confirming marks ${receiveCount} item${receiveCount === 1 ? "" : "s"} as returned and takes them off ${d.projectName}. Every change is recorded in the history.`
                      : `Confirming puts ${receiveCount} item${receiveCount === 1 ? "" : "s"} on ${d.projectName}: ${d.counts.existing} known, the rest created new. Every change is recorded in the history.`}
                  </p>
                )}
                {!isList && (
                  <ConfirmButton
                    action={(isReturn ? confirmReturnAction : confirmDeliveryAction).bind(null, id)}
                    disabled={d.blockers.length > 0}
                    count={receiveCount}
                    mode={mode}
                  />
                )}
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
