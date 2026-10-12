import Link from "next/link";
import { CircleAlert, FileText, Loader2, Sparkles } from "lucide-react";
import { ActionForm, Field, Select, SubmitButton } from "@/components/forms";
import { Badge, Card, CardHeader, KeyValues, Mono, PageHeader } from "@/components/ui";
import { DOCUMENT_KIND_LABEL, DOCUMENT_STATUS_LABEL, todayIso } from "@/lib/format";
import type { T } from "@/lib/i18n/core";
import { getExtractor } from "@/server/ai";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { getCategoryTree } from "@/server/domain/categories";
import { copyNames, deliveredItemsByLine, suggestedSets } from "@/server/domain/document-sets";
import { TypePicker } from "@/components/type-picker";
import { getConsolidation } from "@/server/domain/consolidate";
import { hasRole } from "@/server/domain/context";
import { getDocumentReview, listReturnableItems, releaseStaleExtractions } from "@/server/domain/documents";
import { listProjectOptions } from "@/server/domain/projects";
import { listRentalHouses } from "@/server/domain/rental-houses";
import { getFormat, getT, getTN, getTranslateMessage } from "@/server/i18n";
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
  changeLineTypeAction,
  createAllSetsFromDocumentAction,
  addFromListAction,
  removeNotOnListAction,
  finishListAction,
} from "../actions";
import { RESOLUTION, RETURN_RESOLUTION, resolutionText } from "../resolution";
import { AddLineCard, AutoRefresh, ConfirmButton, LineCard } from "../review";
import { ReturnDueCard } from "@/components/return-due";
import { containerReturnInfo } from "@/server/domain/return-dates";
import { previewNeedsForDocument } from "@/server/domain/planned-needs";

const STATUS_TONE: Record<string, "ok" | "accent" | "danger" | "neutral" | "info"> = {
  confirmed: "ok",
  extracted: "accent",
  uploaded: "accent",
  processing: "info",
  failed: "danger",
  discarded: "neutral",
};

function Files({ t, files }: { t: T; files: { id: string; fileName: string; mimeType: string }[] }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title={t("Original")} />
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
function ProjectPanel({ id, d, t, tm }: { id: string; d: Review; t: T; tm: (msg: string | null | undefined) => string }) {
  const { doc, projectHints: hints } = d;
  const printed = hints ? [hints.title, hints.number && t("project no. {n}", { n: hints.number }), hints.customer].filter(Boolean).join(" · ") : null;
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold">{t("Project")}</h2>
      {printed && (
        <p className="mt-1 text-sm text-muted">
          {t("On the document:")} <span className="text-text">{printed}</span>
        </p>
      )}
      {doc.projectId && d.projectDetection && (
        <p className="mt-2 text-sm text-ok">
          {t("Detected:")} <span className="font-medium">{d.projectName}</span> {t("({how}). Change it below if it is wrong.", { how: tm(d.projectDetection.how) })}
        </p>
      )}
      {doc.projectId && !d.projectDetection && !d.projectMismatch && (
        <p className="mt-2 text-sm text-ok">
          {t("Using project")} <span className="font-medium">{d.projectName}</span>.
        </p>
      )}
      {d.projectMismatch && (
        <p className="mt-2 flex items-start gap-1.5 text-sm text-warn">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            {t("This document looks like it is for")}{" "}
            <Link href={`/projects/${d.projectMismatch.id}`} className="font-medium underline">
              {d.projectMismatch.name}
            </Link>
            {t(", not {project}. Check the project below.", { project: d.projectName ?? "" })}
          </span>
        </p>
      )}
      {!doc.projectId && (
        <>
          <p className="mt-2 text-sm text-warn">{hints ? t("No matching project found. Choose one below, or create it from the document.") : t("Choose the project below.")}</p>
          <details className="mt-3" open={Boolean(hints?.title)}>
            <summary className="cursor-pointer text-sm font-medium text-accent">{hints?.title ? t("Create project “{title}”", { title: hints.title }) : t("Create project")}</summary>
            <ActionForm action={createProjectFromDocumentAction.bind(null, id)} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t("Name")} name="name" id="np-name" defaultValue={hints?.title} required />
              <Field label={t("Code")} name="code" id="np-code" placeholder={t("Short code (optional)")} />
              <Field label={t("Production company")} name="productionCompany" id="np-company" defaultValue={hints?.customer} className="sm:col-span-2" />
              <Field label={t("Start")} name="startDate" id="np-start" type="date" defaultValue={hints?.startDate} />
              <Field label={t("End")} name="endDate" id="np-end" type="date" defaultValue={hints?.endDate} />
              <div className="sm:col-span-2">
                <SubmitButton pendingText={t("Creating…")}>{t("Create project and use it")}</SubmitButton>
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
  const [t, tm, f, tn] = await Promise.all([getT(), getTranslateMessage(), getFormat(), getTN()]);
  const canEdit = hasRole(ctx, "member");
  const editable = canEdit && (doc.status === "uploaded" || doc.status === "extracted" || doc.status === "failed");
  const aiAvailable = getExtractor().available;
  const [projects, houses] = editable ? await Promise.all([listProjectOptions(db, ctx, { activeOnly: true }), listRentalHouses(db, ctx)]) : [[], []];
  const isReturn = doc.kind === "return_note";
  const isList = doc.kind === "inventory_list";
  const consolidation = isList && editable ? await getConsolidation(db, ctx, id) : null;
  const mode = isReturn ? ("return" as const) : ("delivery" as const);
  const due = doc.kind === "delivery_note" ? await containerReturnInfo(db, ctx, { kind: "document", id }) : null;
  const needsPreview = editable && doc.kind === "delivery_note" ? await previewNeedsForDocument(db, ctx, doc, todayIso()) : [];
  const setSuggestions = !isReturn && doc.status === "confirmed" ? await suggestedSets(db, ctx.workspaceId, id) : [];
  // Confirmed delivery: what each line brought, so a wrongly chosen type can still be corrected.
  const fromLine = !isReturn && doc.status === "confirmed" && doc.kind === "delivery_note" && hasRole(ctx, "member") ? (await deliveredItemsByLine(db, ctx.workspaceId, id)).items : null;
  const canCreateSets = hasRole(ctx, "member");
  const itemOptions = editable && isReturn && doc.projectId ? (await listReturnableItems(db, ctx, doc.projectId, doc.id)).map((i) => ({ value: i.id, label: i.label })) : [];
  // Unknown products on a delivery note: a pre-filled "create" strip per line.
  const unknown = editable && !isReturn ? d.lines.filter((l) => l.resolution === "pending" && !l.matchedEquipmentTypeId) : [];
  const categoryTree = unknown.length ? (await getCategoryTree(db, ctx)).flat : [];
  const categoryOptions = categoryTree.map((c) => ({ value: c.id, label: `${"  ".repeat(c.depth)}${tn(c.name)}` }));
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
  const caseLines = d.lines.filter((l) => l.resolution === "create_set").length;
  const receiveCount = d.lines.filter((l) => l.resolution === "create_new" || l.resolution === "match_existing").reduce((n, l) => n + l.quantity, 0);
  const alreadyRemoved = d.returnOverview?.removed.reduce((n, r) => n + Math.min(r.onNote, r.units), 0) ?? 0;

  return (
    <>
      {doc.status === "processing" && <AutoRefresh />}
      <PageHeader
        back={{ href: doc.projectId ? `/projects/${doc.projectId}/documents` : "/documents", label: d.projectName ?? t("Documents") }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {t(DOCUMENT_KIND_LABEL[doc.kind]!)} {doc.documentNumber && <Mono>{doc.documentNumber}</Mono>}
            <Badge tone={STATUS_TONE[doc.status]}>{DOCUMENT_STATUS_LABEL[doc.status] === "Uploaded" ? t("Enter lines") : t(DOCUMENT_STATUS_LABEL[doc.status]!)}</Badge>
          </span>
        }
        subtitle={[d.rentalHouseName, d.projectName, doc.documentDate && f.formatDate(doc.documentDate), d.uploadedBy && t("uploaded by {name}", { name: d.uploadedBy })].filter(Boolean).join(" · ")}
      />

      {d.duplicate && doc.status !== "confirmed" && (
        <p className="mb-4 flex items-start gap-2 rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            {t("This looks like a document that was already uploaded ({number}, {status}).", {
              number: d.duplicate.documentNumber ?? t("same file"),
              status: DOCUMENT_STATUS_LABEL[d.duplicate.status] ? t(DOCUMENT_STATUS_LABEL[d.duplicate.status]!).toLowerCase() : "",
            })}{" "}
            <Link href={`/documents/${d.duplicate.id}`} className="font-medium underline">
              {t("Open it")}
            </Link>{" "}
            {t("and discard this one if it is the same delivery.")}
          </span>
        </p>
      )}

      {d.outcome && (
        <p role="status" className="mb-4 rounded-lg bg-ok/10 px-3 py-2 text-sm text-ok">
          {tm(d.outcome.summary)}
        </p>
      )}


      {doc.status === "processing" && (
        <Card className="mb-6 flex items-center gap-3 p-5">
          <Loader2 className="size-5 animate-spin text-accent" />
          <div>
            <div className="font-medium">{t("Reading the document…")}</div>
            <div className="text-sm text-muted">{t("Usually 20–60 seconds. You can leave this page; nothing changes until you confirm.")}</div>
          </div>
        </Card>
      )}

      {doc.status === "failed" && (
        <Card className="mb-6 p-4">
          <p className="text-sm text-danger">{doc.extractionError ? tm(doc.extractionError) : t("Reading the document failed.")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {canEdit && aiAvailable && (
              <ActionForm action={retryExtractionAction.bind(null, id)}>
                <SubmitButton variant="secondary" pendingText={t("Starting…")}>
                  <Sparkles className="size-4" /> {t("Read again")}
                </SubmitButton>
              </ActionForm>
            )}
            <span className="self-center text-sm text-muted">{t("or add the lines by hand below.")}</span>
          </div>
        </Card>
      )}

      {d.warnings.length > 0 && doc.status !== "confirmed" && (
        <Card className="mb-6 p-4">
          <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-warn">
            <Sparkles className="size-4" /> {t("Notes from the AI reading")}
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
              {(d.projectHints || !doc.projectId) && <ProjectPanel id={id} d={d} t={t} tm={tm} />}
              <Card className="p-4">
                <ActionForm action={updateHeaderAction.bind(null, id)} className="grid gap-3 sm:grid-cols-2">
                  <Select label={t("Project")} name="projectId" id="h-project" placeholder={t("Choose…")} defaultValue={doc.projectId} options={projects.map((p) => ({ value: p.id, label: p.name }))} />
                  <Select label={t("Rental house")} name="rentalHouseId" id="h-rh" placeholder={t("Choose…")} defaultValue={doc.rentalHouseId} options={houses.map((h) => ({ value: h.id, label: h.name }))} />
                  <Field label={t("Document number")} name="documentNumber" id="h-number" defaultValue={doc.documentNumber} spellCheck={false} />
                  <Field label={t("Date")} name="documentDate" id="h-date" type="date" defaultValue={doc.documentDate} />
                  {doc.kind === "delivery_note" && (
                    <Field
                      label={t("Return by")}
                      name="returnDue"
                      id="h-return"
                      type="date"
                      defaultValue={doc.returnDue}
                      hint={due?.inherited ? t("Empty = project end ({date})", { date: f.formatDate(due.inherited) }) : t("Empty = project end (not set yet)")}
                    />
                  )}
                  <div className="sm:col-span-2">
                    <SubmitButton variant="secondary">{t("Save details")}</SubmitButton>
                  </div>
                </ActionForm>
              </Card>

              <div className="flex flex-wrap gap-2 text-xs">
                {(["create_new", "match_existing", "create_set", "pending", "discrepancy", "ignore"] as const).map((k) => {
                  const n = d.lines.filter((l) => l.resolution === k).length;
                  return n ? (
                    <Badge key={k} tone={labels[k]!.tone}>
                      {n} × {resolutionText(t, labels[k]!.label)}
                    </Badge>
                  ) : null;
                })}
              </div>

              {!isReturn && new Set(d.lines.map((l) => l.setName).filter(Boolean)).size > 0 && (
                <p className="text-sm text-muted">
                  {t("▣ The note groups items into {n} set(s). After confirming you can create them in one click.", { n: new Set(d.lines.map((l) => l.setName).filter(Boolean)).size })}
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
                  <h2 className="text-sm font-semibold">{t("Double check: removed with this note")}</h2>
                  <p className="mt-1 text-sm text-muted">
                    {t("{n} of {total} found on the note.", { n: d.returnOverview.removed.filter((r) => r.onNote >= r.units).length, total: d.returnOverview.removed.length })}
                    {d.returnOverview.removed.some((r) => r.onNote < r.units) && ` ${t("Check the ones marked — they were removed but the note does not list them.")}`}
                  </p>
                  <ul className="mt-2 max-h-56 space-y-0.5 overflow-y-auto text-sm">
                    {d.returnOverview.removed.map((r) => (
                      <li key={r.id} className="flex justify-between gap-2">
                        <Link href={`/equipment/${r.id}`} className="truncate hover:underline">
                          {r.label}
                        </Link>
                        {r.onNote >= r.units ? (
                          <span className="text-ok">{t("✓ on note")}</span>
                        ) : (
                          <span className="text-warn">{r.onNote > 0 ? t("{n} of {total} on note", { n: r.onNote, total: r.units }) : t("not on note")}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              {d.returnOverview && (
                <Card className="p-4">
                  <h2 className="text-sm font-semibold">{t("After this return")}</h2>
                  <p className="mt-1 text-sm text-muted">
                    {d.rentalHouseName ? t("{n} going back to {house}", { n: d.returnOverview.returning, house: d.rentalHouseName }) : t("{n} going back to the rental house", { n: d.returnOverview.returning })} ·{" "}
                    <span className={d.returnOverview.staying.length ? "font-medium text-text" : ""}>
                      {t("{n} stay on the project", { n: d.returnOverview.staying.reduce((n, i) => n + i.units, 0) })}
                    </span>
                    {d.returnOverview.staying.length > 0 && ` ${t("(partial return — that is fine)")}`}
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
                  <CardHeader title={t("Compared with the database")} />
                  {!doc.projectId || !doc.rentalHouseId ? (
                    <p className="px-4 py-3 text-sm text-warn">{t("Choose the project and the rental house above to compare.")}</p>
                  ) : (
                    <div className="divide-y divide-border">
                      <section className="px-4 py-3">
                        <h3 className="text-sm font-medium text-ok">{t("✓ On the list and in the database ({n})", { n: consolidation.present.reduce((n, x) => n + x.units, 0) })}</h3>
                        {consolidation.present.length > 0 && (
                          <details className="mt-1 text-sm text-muted">
                            <summary className="cursor-pointer">{t("Show")}</summary>
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
                          <h3 className="text-sm font-medium text-warn">{t("On the list, missing in the database ({n})", { n: consolidation.missing.reduce((n, x) => n + x.units, 0) })}</h3>
                          {consolidation.missing.filter((m) => m.canAdd).length > 1 && (
                            <ActionForm action={addFromListAction.bind(null, id, "all")}>
                              <SubmitButton variant="secondary" className="!px-2.5 !py-1 text-xs" pendingText="…">
                                {t("Add all")}
                              </SubmitButton>
                            </ActionForm>
                          )}
                        </div>
                        {consolidation.missing.length === 0 ? (
                          <p className="mt-1 text-sm text-muted">{t("Nothing.")}</p>
                        ) : (
                          <ul className="mt-1 divide-y divide-border">
                            {consolidation.missing.map((m) => (
                              <li key={`${m.lineId}-${m.label}`} className="flex items-center gap-2 py-1.5">
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm">{m.label}</div>
                                  {m.reason && <div className="text-xs text-warn">{tm(m.reason)}</div>}
                                </div>
                                {m.canAdd && (
                                  <ActionForm action={addFromListAction.bind(null, id, m.lineId)}>
                                    <SubmitButton variant="secondary" className="!px-2.5 !py-1 text-xs" pendingText="…">
                                      {t("Add")}
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
                          <h3 className="text-sm font-medium text-danger">{t("In the database, not on the list ({n})", { n: consolidation.extra.reduce((n, x) => n + x.units, 0) })}</h3>
                          {consolidation.extra.length > 1 && (
                            <ActionForm action={removeNotOnListAction.bind(null, id, "all")}>
                              <SubmitButton variant="secondary" className="!px-2.5 !py-1 text-xs" pendingText="…">
                                {t("Remove all")}
                              </SubmitButton>
                            </ActionForm>
                          )}
                        </div>
                        {consolidation.extra.length === 0 ? (
                          <p className="mt-1 text-sm text-muted">{t("Nothing.")}</p>
                        ) : (
                          <ul className="mt-1 divide-y divide-border">
                            {consolidation.extra.map((x) => (
                              <li key={x.itemId} className="flex items-center gap-2 py-1.5">
                                <Link href={`/equipment/${x.itemId}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
                                  {x.label}
                                </Link>
                                <ActionForm action={removeNotOnListAction.bind(null, id, x.itemId)}>
                                  <SubmitButton variant="ghost" className="!px-2.5 !py-1 text-xs text-muted hover:text-danger" pendingText="…">
                                    {t("Remove")}
                                  </SubmitButton>
                                </ActionForm>
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="mt-2 text-xs text-muted">{t("Removing records the item as returned, with this list as the reason. Nothing is deleted; it can be undone from the history.")}</p>
                      </section>
                    </div>
                  )}
                </Card>
              )}

              <Card className="space-y-3 p-4">
                {isList ? (
                  <>
                    <p className="text-sm text-muted">{t("When the differences are sorted out, close the list. It stays as a record of the check.")}</p>
                    <ActionForm action={finishListAction.bind(null, id)}>
                      <SubmitButton disabled={!doc.projectId || !doc.rentalHouseId}>{t("Close the list")}</SubmitButton>
                    </ActionForm>
                  </>
                ) : d.blockers.length > 0 ? (
                  <ul className="space-y-1 text-sm text-warn">
                    {d.blockers.slice(0, 6).map((b, i) => (
                      <li key={i}>• {tm(b.message)}</li>
                    ))}
                    {d.blockers.length > 6 && <li>{t("… and {n} more", { n: d.blockers.length - 6 })}</li>}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">
                    {isReturn
                      ? alreadyRemoved > 0
                        ? receiveCount - alreadyRemoved > 0
                          ? alreadyRemoved === 1
                            ? t("Confirming records the note: 1 already removed item confirmed, {more} more taken off {project} as returned. Every change is recorded in the history.", { more: receiveCount - alreadyRemoved, project: d.projectName ?? "" })
                            : t("Confirming records the note: {n} already removed items confirmed, {more} more taken off {project} as returned. Every change is recorded in the history.", { n: alreadyRemoved, more: receiveCount - alreadyRemoved, project: d.projectName ?? "" })
                          : alreadyRemoved === 1
                            ? t("Confirming records the note: 1 already removed item confirmed. Every change is recorded in the history.")
                            : t("Confirming records the note: {n} already removed items confirmed. Every change is recorded in the history.", { n: alreadyRemoved })
                        : receiveCount === 1
                          ? t("Confirming marks 1 item as returned and takes them off {project}. Every change is recorded in the history.", { project: d.projectName ?? "" })
                          : t("Confirming marks {n} items as returned and takes them off {project}. Every change is recorded in the history.", { n: receiveCount, project: d.projectName ?? "" })
                      : [
                          receiveCount === 1
                            ? t("Confirming puts 1 item on {project}: {known} known, the rest created new.", { project: d.projectName ?? "", known: d.counts.existing })
                            : t("Confirming puts {n} items on {project}: {known} known, the rest created new.", { n: receiveCount, project: d.projectName ?? "", known: d.counts.existing }),
                          caseLines ? (caseLines === 1 ? t("1 case becomes a set.") : t("{n} cases become a set.", { n: caseLines })) : null,
                          t("Every change is recorded in the history."),
                        ]
                          .filter(Boolean)
                          .join(" ")}
                  </p>
                )}
                {needsPreview.length > 0 && (
                  <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 text-sm">
                    <p className="font-medium">{t("This delivery brings planned equipment:")}</p>
                    <ul className="mt-1 space-y-0.5 text-muted">
                      {needsPreview.map((n) => (
                        <li key={n.id}>
                          {t("{n} × {label} ({from} – {until}) · return by {until}", { n: n.units, label: tn(n.label), from: f.formatDate(n.needFrom), until: f.formatDate(n.needUntil) })}
                        </li>
                      ))}
                    </ul>
                  </div>
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
                  <summary className="cursor-pointer text-muted">{t("Discard this document")}</summary>
                  <ActionForm action={discardDocumentAction.bind(null, id)} className="mt-2 flex items-end gap-2">
                    <Field name="reason" id="discard-reason" placeholder={t("Reason (e.g. uploaded twice)")} aria-label={t("Reason")} className="flex-1" />
                    <SubmitButton variant="danger">{t("Discard")}</SubmitButton>
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
                      { label: t("Rental house"), value: d.rentalHouseName },
                      { label: t("Project"), value: doc.projectId ? <Link className="hover:underline" href={`/projects/${doc.projectId}`}>{d.projectName}</Link> : null },
                      { label: t("Document date"), value: f.formatDate(doc.documentDate) },
                      { label: t("Read by"), value: doc.extractionModel ? `${doc.extractionProvider} (${doc.extractionModel})` : t("entered manually") },
                      { label: t("Confirmed"), value: doc.confirmedAt ? f.formatDateTime(doc.confirmedAt) : t("Not yet") },
                    ]}
                  />
                </Card>
                {due && doc.status === "confirmed" && (
                  <ReturnDueCard
                    target={{ kind: "document", id }}
                    info={{ due: due.due, own: due.own, source: due.own ? "document" : due.inherited ? "project" : null }}
                    canEdit={hasRole(ctx, "member")}
                  />
                )}
                <div className="overflow-x-auto rounded-xl border border-border bg-surface">
                  <table className="w-full min-w-[36rem] text-sm">
                    <thead className="border-b border-border bg-surface-2/60 text-left text-xs text-muted">
                      <tr>
                        <th className="px-4 py-2 font-medium">#</th>
                        <th className="px-3 py-2 font-medium">{t("On document")}</th>
                        <th className="px-3 py-2 text-right font-medium">{t("Qty")}</th>
                        <th className="px-3 py-2 font-medium">{t("Serial / asset")}</th>
                        <th className="px-3 py-2 font-medium">{t("Equipment")}</th>
                        <th className="px-3 py-2 font-medium">{t("Result")}</th>
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
                                {l.typeName && tn(l.typeName)}
                              </Link>
                            ) : (
                              (l.typeName ? tn(l.typeName) : <span className="text-muted">—</span>)
                            )}
                            {l.matchReason && doc.status !== "confirmed" && <div className="text-xs text-muted">{tm(l.matchReason)}</div>}
                            {fromLine && (fromLine.get(l.id)?.length ?? 0) > 0 && (
                              <details className="mt-1">
                                <summary className="cursor-pointer text-xs text-muted hover:text-text">{t("Change type")}</summary>
                                <ActionForm action={changeLineTypeAction.bind(null, id, l.id)} className="mt-2 w-64 space-y-2">
                                  <TypePicker name="typeId" id={`type-${l.id}`} aria-label={t("Right type for line {n}", { n: l.lineNumber })} />
                                  <p className="text-xs text-muted">
                                    {t("Changes the {n} piece(s) from this line; the next note with “{description}” gets the right type.", { n: fromLine.get(l.id)!.reduce((n, i) => n + i.quantity, 0), description: l.description })}
                                  </p>
                                  <SubmitButton variant="secondary" className="!py-1 text-xs" pendingText="…">
                                    {t("Change type")}
                                  </SubmitButton>
                                </ActionForm>
                              </details>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <Badge tone={labels[l.resolution]?.tone}>
                              {doc.status === "confirmed" && l.resolution === "create_new" ? t("Created") : doc.status === "confirmed" && isReturn && l.resolution === "match_existing" ? t("Returned") : labels[l.resolution] ? resolutionText(t, labels[l.resolution]!.label) : undefined}
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
            <Files t={t} files={d.files} />
          </div>
        )}
      </div>
      {/* Last on the page: after confirming a note, the next step is turning its groups into sets. */}
      {setSuggestions.length > 0 && (
        <Card className="mt-6">
          <CardHeader title={t("Sets on this note")} />
          <p className="px-4 pt-3 text-sm text-muted">
            {t("The note groups these items into sets. Create them in one click: packed, with exactly these contents expected.")}
          </p>
          <ul className="divide-y divide-border">
            {setSuggestions.map((sg) => (
              <li key={sg.name} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{sg.name}</div>
                  <div className="text-xs text-muted">
                    {sg.units === 1 ? t("1 piece") : t("{n} pieces", { n: sg.units })} {sg.lines === 1 ? t("from 1 line") : t("from {n} lines", { n: sg.lines })}
                  </div>
                </div>
                {sg.existing ? (
                  <Link href={`/sets/${sg.existing.id}`} className="text-sm text-accent hover:underline">
                    {t("Open {name}", { name: sg.existing.name })}
                  </Link>
                ) : sg.createdSets.length > 0 ? (
                  <span className="text-sm">
                    {sg.createdSets.map((c, i) => (
                      <span key={c.id}>
                        {i > 0 && ", "}
                        <Link href={`/sets/${c.id}`} className="text-accent hover:underline">
                          {c.name}
                        </Link>
                      </span>
                    ))}
                  </span>
                ) : sg.copies > 1 && canCreateSets ? (
                  <div className="w-full space-y-2 rounded-lg bg-surface-2/60 p-3">
                    <p className="text-sm">
                      {t("Everything comes {n}×: that makes", { n: sg.copies })} <strong>{t("{n} identical sets", { n: sg.copies })}</strong>{" "}
                      {t("of {contents}. Name them:", { contents: sg.perCopy.map((p) => `${p.units} × ${tn(p.typeName)}`).join(", ") })}
                    </p>
                    <ActionForm action={createSetFromDocumentAction.bind(null, id, sg.name)} className="space-y-2">
                      <div className="grid gap-2 sm:grid-cols-2">
                        {copyNames(sg.name, sg.copies).map((n, i) => (
                          <Field key={n} name={`setName_${i}`} defaultValue={n} required maxLength={80} aria-label={t("Name of set {n} of {name}", { n: i + 1, name: sg.name })} />
                        ))}
                      </div>
                      <SubmitButton pendingText={t("Creating…")}>{t("Create {n} sets", { n: sg.copies })}</SubmitButton>
                    </ActionForm>
                    <ActionForm action={createSetFromDocumentAction.bind(null, id, sg.name)}>
                      <SubmitButton variant="ghost" className="!px-0 text-xs" pendingText="…">
                        {t("Or one set with everything")}
                      </SubmitButton>
                    </ActionForm>
                  </div>
                ) : (
                  canCreateSets && (
                    <ActionForm action={createSetFromDocumentAction.bind(null, id, sg.name)}>
                      <SubmitButton variant="secondary" pendingText="…">
                        {t("Create set")}
                      </SubmitButton>
                    </ActionForm>
                  )
                )}
              </li>
            ))}
          </ul>
          {canCreateSets && setSuggestions.filter((sg) => !sg.existing && sg.createdSets.length === 0).length > 1 && (
            <ActionForm action={createAllSetsFromDocumentAction.bind(null, id, setSuggestions.filter((sg) => !sg.existing && sg.createdSets.length === 0).map((sg) => sg.name))} className="border-t border-border px-4 py-3">
              <SubmitButton pendingText={t("Creating…")}>{t("Create all {n} sets", { n: setSuggestions.filter((sg) => !sg.existing && sg.createdSets.length === 0).length })}</SubmitButton>
            </ActionForm>
          )}
        </Card>
      )}
    </>
  );
}
