import Link from "next/link";
import { CircleCheck, CircleAlert, Pencil } from "lucide-react";
import { ActivityList } from "@/components/activity";
import { CaseProgress } from "@/components/case-list";
import { FilterBar, FilterSearch } from "@/components/filters";
import { AddLineForm, LineEditor } from "@/components/line-editor";
import { PhotoGallery } from "@/components/photo-gallery";
import { Badge, Card, CardHeader, ConditionBadge, LinkButton, Mono, PageHeader, StatusBadge } from "@/components/ui";
import { cn } from "@/lib/format";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { getCaseDetail, listLineTargets, listPackCandidates } from "@/server/domain/cases";
import { hasRole } from "@/server/domain/context";
import { listActivity } from "@/server/domain/overview";
import { listPhotos } from "@/server/domain/photos";
import { assertUuid, orNotFound } from "@/server/pages";
import { addLineAction, packByCodeAction, packItemAction, removeLineAction, unpackItemAction, updateLineAction } from "../actions";
import { PackButton, PackByCode, SmallActionButton } from "../pack-panel";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  assertUuid(id);
  const d = await orNotFound(getCaseDetail(getDb(), await getCtx(), id));
  return { title: d.case.name };
}

export default async function CasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; edit?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  assertUuid(id);
  const ctx = await getCtx();
  const db = getDb();
  const d = await orNotFound(getCaseDetail(db, ctx, id));
  const canEdit = hasRole(ctx, "member") && !d.case.archivedAt;
  const [photos, history, candidates, targets] = await Promise.all([
    listPhotos(db, ctx, { caseId: id }),
    listActivity(db, ctx, { caseId: id, limit: 100 }),
    canEdit ? listPackCandidates(db, ctx, id, sp.q) : Promise.resolve([]),
    canEdit && sp.edit === "1" ? listLineTargets(db, ctx) : Promise.resolve(null),
  ]);
  const { comparison: cmp } = d;
  const isNeeded = (c: { equipmentTypeId: string; categoryId: string | null; caseId: string | null; status: string }) =>
    !c.caseId && c.status !== "missing" && (d.neededTypeIds.has(c.equipmentTypeId) || (c.categoryId !== null && d.neededCategoryIds.has(c.categoryId)));
  // Items that fill a gap in this case come first.
  const sortedCandidates = [...candidates].sort((a, b) => Number(isNeeded(b)) - Number(isNeeded(a)));
  const byId = new Map(d.items.map((i) => [i.id, i]));
  const editing = sp.edit === "1" && canEdit;

  return (
    <>
      <PageHeader
        back={{ href: `/projects/${d.case.projectId}/cases`, label: d.projectName }}
        title={
          <span className="flex items-center gap-2">
            <span className="truncate">{d.case.name}</span>
            {d.case.archivedAt && <Badge>Archived</Badge>}
          </span>
        }
        subtitle={[d.case.code, d.templateName && `Template: ${d.templateName}`, d.case.barcode && `Barcode ${d.case.barcode}`].filter(Boolean).join(" · ")}
        actions={
          canEdit && (
            <LinkButton href={`/cases/${id}/edit`}>
              <Pencil className="size-4" /> Edit
            </LinkButton>
          )
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Status first on every screen size */}
        <Card className="flex items-center justify-between gap-4 p-4 lg:col-span-2">
          <div>
            <div className="text-xs font-semibold tracking-wide text-muted uppercase">Expected vs. packed</div>
            <p className={cn("mt-1 text-sm", cmp.complete ? "text-ok" : "text-warn")}>
              {cmp.expectedTotal === 0
                ? "No expected contents defined."
                : cmp.complete
                  ? "Complete — everything expected is in the case."
                  : [cmp.missingTotal > 0 && `${cmp.missingTotal} expected item${cmp.missingTotal === 1 ? "" : "s"} not in case`, cmp.extraTotal > 0 && `${cmp.extraTotal} not expected`]
                      .filter(Boolean)
                      .join(" · ")}
            </p>
          </div>
          <div className="w-32 shrink-0 text-right">
            <CaseProgress matched={cmp.matchedTotal} expected={cmp.expectedTotal} extra={cmp.extraTotal} size="lg" />
          </div>
        </Card>

        {canEdit && (
          <div className="space-y-6 lg:order-2">
            <Card>
              <CardHeader title="Pack items" />
              <div className="space-y-4 p-4">
                <PackByCode action={packByCodeAction.bind(null, id)} />
                <div className="border-t border-border pt-3">
                  <FilterBar hasFilters={Boolean(sp.q)}>
                    <FilterSearch value={sp.q} placeholder="Find project equipment…" />
                  </FilterBar>
                  {candidates.length === 0 ? (
                    <p className="text-sm text-muted">{sp.q ? "Nothing found on this project." : "All project equipment is in this case."}</p>
                  ) : (
                    <ul className="-mx-1 max-h-[28rem] divide-y divide-border overflow-y-auto">
                      {sortedCandidates.map((c) => (
                        <li key={c.id} className="flex items-center gap-2 px-1 py-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <Link href={`/equipment/${c.id}`} className="truncate text-sm hover:underline">
                                {c.typeName}
                              </Link>
                              {isNeeded(c) && <Badge tone="warn">needed</Badge>}
                              {c.status !== "on_project" && <StatusBadge status={c.status} />}
                            </div>
                            <div className="truncate text-xs text-muted">
                              <Mono>{c.serialNumber ? `SN ${c.serialNumber}` : c.trackingMode === "bulk" ? `Qty ${c.quantity}` : "No serial"}</Mono>
                              {c.caseName && <span className="text-warn"> · in {c.caseName}</span>}
                            </div>
                          </div>
                          <PackButton action={packItemAction.bind(null, id, c.id)} move={Boolean(c.caseId)} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </Card>
          </div>
        )}

        <div className="min-w-0 space-y-6 lg:order-1">
        <Card className="min-w-0">
          <CardHeader
            title="Contents check"
            action={
              canEdit &&
              (editing ? (
                <Link href={`/cases/${id}`} className="text-xs text-accent hover:underline">
                  Done
                </Link>
              ) : (
                <Link href={`/cases/${id}?edit=1`} className="text-xs text-muted hover:text-text">
                  Edit expected contents
                </Link>
              ))
            }
          />
          {editing && targets ? (
            <div className="space-y-4 p-4">
              <LineEditor
                lines={d.lines.map((l) => ({
                  id: l.id,
                  label: l.label,
                  quantity: l.quantity,
                  typeName: l.typeName,
                  categoryName: l.categoryName,
                  updateAction: updateLineAction.bind(null, id, l.id),
                  removeAction: removeLineAction.bind(null, id, l.id),
                }))}
              />
              <div className="border-t border-border pt-4">
                <h3 className="mb-2 text-sm font-medium">Add expected item</h3>
                <AddLineForm action={addLineAction.bind(null, id)} types={targets.types} categories={targets.categories} />
              </div>
            </div>
          ) : cmp.lines.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted">
              No expected contents. {canEdit && <Link href={`/cases/${id}?edit=1`} className="text-accent hover:underline">Define what belongs in this case</Link>}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {cmp.lines.map((r) => {
                const ok = r.missing === 0;
                return (
                  <li key={r.line.id} className="flex gap-3 px-4 py-2.5">
                    {ok ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-label="Complete" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-label="Incomplete" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium">{r.line.label}</span>
                        <span className={cn("text-sm tabular-nums", ok ? "text-muted" : "font-semibold text-warn")}>
                          {r.matched} / {r.line.quantity}
                        </span>
                      </div>
                      {r.items.length > 0 && (
                        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                          {r.items.map((it) => (
                            <Link key={it.id} href={`/equipment/${it.id}`} className="hover:underline">
                              <Mono>{byId.get(it.id)?.serialNumber ?? `${it.units} pcs`}</Mono>
                            </Link>
                          ))}
                        </div>
                      )}
                      {!ok && <div className="mt-0.5 text-xs text-warn">{r.missing} not in case</div>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {cmp.extras.length > 0 && !editing && (
            <div className="border-t border-border bg-danger/5 px-4 py-3">
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-danger uppercase">Not expected in this case</h3>
              <ul className="space-y-1">
                {cmp.extras.map((e) => {
                  const it = byId.get(e.id)!;
                  return (
                    <li key={e.id} className="flex items-center justify-between gap-2 text-sm">
                      <Link href={`/equipment/${e.id}`} className="hover:underline">
                        {it.label}
                        {e.units !== it.quantity && ` (${e.units} of ${it.quantity})`}
                      </Link>
                      {canEdit && <SmallActionButton action={unpackItemAction.bind(null, id, e.id)} label="Take out" />}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Card>

        <Card className="min-w-0">
          <CardHeader title={`In this case (${d.items.length})`} />
          {d.items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted">Empty.</p>
          ) : (
            <ul className="divide-y divide-border">
              {d.items.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-2">
                  <div className="min-w-0 flex-1">
                    <Link href={`/equipment/${i.id}`} className="block truncate text-sm font-medium hover:underline">
                      {i.typeName}
                    </Link>
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                      <Mono>{i.serialNumber ? `SN ${i.serialNumber}` : i.trackingMode === "bulk" ? `Qty ${i.quantity}` : "No serial"}</Mono>
                      {i.rentalHouseName && <span>{i.rentalHouseName}</span>}
                      <ConditionBadge condition={i.condition} hideOk />
                    </div>
                  </div>
                  {i.status !== "on_project" && <StatusBadge status={i.status} />}
                  {canEdit && <SmallActionButton action={unpackItemAction.bind(null, id, i.id)} label="Take out" />}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <PhotoGallery photos={photos} target={{ kind: "case", id }} canEdit={canEdit} />

        <Card className="min-w-0">
          <CardHeader title="History" />
          <ActivityList events={history} showProject={false} />
        </Card>
        </div>
      </div>
    </>
  );
}
