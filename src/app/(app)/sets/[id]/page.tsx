import Link from "next/link";
import { CircleCheck, CircleAlert, Pencil } from "lucide-react";
import { ActivityList } from "@/components/activity";
import { CaseProgress } from "@/components/case-list";
import { FilterBar, FilterSearch } from "@/components/filters";
import { QuickExpectedEditor } from "@/components/line-editor";
import { ActionForm, SubmitButton } from "@/components/forms";
import { PhotoGallery } from "@/components/photo-gallery";
import { Badge, Card, CardHeader, ConditionBadge, LinkButton, Mono, PageHeader, StatusBadge } from "@/components/ui";
import { cn } from "@/lib/format";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { getCaseDetail, groupUnits, listLineTargets, listPackCandidates } from "@/server/domain/cases";
import { hasRole } from "@/server/domain/context";
import { listActivity } from "@/server/domain/overview";
import { listPhotos } from "@/server/domain/photos";
import { assertUuid, orNotFound } from "@/server/pages";
import { addLineAction, applyContentsAction, packByCodeAction, packChecklistAction, removeLineAction, stepLineAction, unpackItemAction, unpackUnitsAction } from "../actions";
import { PackChecklist } from "../pack-checklist";
import { Thumb } from "@/components/thumb";
import { PackByCode, SmallActionButton, UnitsButton } from "../pack-panel";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  assertUuid(id);
  const d = await orNotFound(getCaseDetail(getDb(), await getCtx(), id));
  return { title: d.case.name };
}

export default async function CasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; edit?: string; packed?: string }> }) {
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
  // Items without a serial number are interchangeable: one row per group with its unit count.
  // Rows that fill a gap in this case come first.
  // Needed first, then what is not packed anywhere, then what sits in other cases.
  const rank = (c: (typeof candidates)[number]) => (isNeeded(c) ? 0 : c.caseId ? 2 : 1);
  const sortedCandidates = groupUnits(candidates).sort((a, b) => rank(a) - rank(b));
  const missingByType = new Map<string, number>();
  for (const r of cmp.lines) if (r.line.equipmentTypeId && r.missing > 0) missingByType.set(r.line.equipmentTypeId, (missingByType.get(r.line.equipmentTypeId) ?? 0) + r.missing);
  const packedRows = groupUnits(d.items);
  const packedPieces = d.items.reduce((n, i) => n + i.quantity, 0);
  const byId = new Map(d.items.map((i) => [i.id, i]));
  // Contents check: the type's picture, else the first packed item's.
  const lineImage = new Map(cmp.lines.map((r) => [r.line.id, d.lines.find((l) => l.id === r.line.id)?.imageId ?? r.items.map((x) => byId.get(x.id)?.imageId).find(Boolean) ?? null]));
  const editing = sp.edit === "1" && canEdit;

  return (
    <>
      <PageHeader
        back={{ href: `/projects/${d.case.projectId}/sets`, label: d.projectName }}
        title={
          <span className="flex items-center gap-2">
            <span className="truncate">{d.case.name}</span>
            {d.case.archivedAt && <Badge>Archived</Badge>}
          </span>
        }
        subtitle={[d.case.code, d.templateName && `Template: ${d.templateName}`, d.case.barcode && `Barcode ${d.case.barcode}`].filter(Boolean).join(" · ")}
        actions={
          canEdit && (
            <>
              <LinkButton href={`/projects/${d.case.projectId}/remove?caseId=${id}`}>Remove from project</LinkButton>
              <LinkButton href={`/sets/${id}/edit`}>
                <Pencil className="size-4" /> Edit
              </LinkButton>
            </>
          )
        }
      />

      {Number(sp.packed) > 0 && (
        <p role="status" className="mb-4 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm text-ok">
          {sp.packed} piece{sp.packed === "1" ? "" : "s"} from the project packed automatically. Take out anything that doesn&apos;t belong.
        </p>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Status first on every screen size */}
        <Card className="flex items-center justify-between gap-4 p-4 lg:col-span-2">
          <div>
            <div className="text-xs font-semibold tracking-wide text-muted uppercase">Expected vs. packed</div>
            <p className={cn("mt-1 text-sm", cmp.complete ? "text-ok" : "text-warn")}>
              {cmp.expectedTotal === 0
                ? "No expected contents defined."
                : cmp.complete
                  ? "Complete — everything expected is in the set."
                  : [cmp.missingTotal > 0 && `${cmp.missingTotal} expected item${cmp.missingTotal === 1 ? "" : "s"} not in set`, cmp.extraTotal > 0 && `${cmp.extraTotal} not expected`]
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
                    <p className="text-sm text-muted">{sp.q ? "Nothing found on this project." : "All project equipment is in this set."}</p>
                  ) : (
                    <PackChecklist
                      action={packChecklistAction.bind(null, id)}
                      rows={sortedCandidates.map((c) => ({
                        key: c.id,
                        itemIds: c.itemIds,
                        typeName: c.typeName,
                        serialNumber: c.serialNumber,
                        assetNumber: c.assetNumber,
                        units: c.units,
                        caseName: c.caseName,
                        status: c.status,
                        condition: c.condition,
                        needed: isNeeded(c) ? (missingByType.get(c.equipmentTypeId) ?? 1) : 0,
                        imageId: c.imageId,
                      }))}
                    />
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
                <Link href={`/sets/${id}`} className="text-xs text-accent hover:underline">
                  Done
                </Link>
              ) : (
                <Link href={`/sets/${id}?edit=1`} className="text-xs text-muted hover:text-text">
                  Edit expected contents
                </Link>
              ))
            }
          />
          {editing && targets ? (
            <div className="p-4">
              <QuickExpectedEditor
                lines={d.lines.map((l) => ({
                  id: l.id,
                  label: l.label,
                  quantity: l.quantity,
                  hint: l.typeName ? l.typeName : `any ${l.categoryName ?? "item"} (incl. subcategories)`,
                  less: stepLineAction.bind(null, id, l.id, -1),
                  more: stepLineAction.bind(null, id, l.id, 1),
                  remove: removeLineAction.bind(null, id, l.id),
                }))}
                addAction={addLineAction.bind(null, id)}
                categories={targets.categories}
                useContents={{ action: applyContentsAction.bind(null, id), pieces: packedPieces }}
              />
            </div>
          ) : cmp.lines.length === 0 ? (
            <div className="space-y-3 px-4 py-5 text-sm text-muted">
              <p>No expected contents yet — the check compares against them.</p>
              {canEdit && (
                <div className="flex flex-wrap items-center gap-3">
                  {packedPieces > 0 && (
                    <ActionForm action={applyContentsAction.bind(null, id)}>
                      <SubmitButton variant="secondary" pendingText="…">
                        Use what&apos;s packed now ({packedPieces})
                      </SubmitButton>
                    </ActionForm>
                  )}
                  <Link href={`/sets/${id}?edit=1`} className="text-accent hover:underline">
                    {packedPieces > 0 ? "or define it by hand" : "Define what belongs in this set"}
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {cmp.lines.map((r) => {
                const ok = r.missing === 0;
                return (
                  <li key={r.line.id} className="flex gap-3 px-4 py-2.5">
                    {ok ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-label="Complete" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-label="Incomplete" />}
                    <Thumb photoId={lineImage.get(r.line.id) ?? null} name={r.line.label} className="size-9" />
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
                      {!ok && <div className="mt-0.5 text-xs text-warn">{r.missing} not in set</div>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {cmp.extras.length > 0 && !editing && (
            <div className="border-t border-border bg-danger/5 px-4 py-3">
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-danger uppercase">Not expected in this set</h3>
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
          <CardHeader title={`In this set (${packedRows.reduce((n, r) => n + r.units, 0)})`} />
          {d.items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted">Empty.</p>
          ) : (
            <ul className="divide-y divide-border">
              {packedRows.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                  <Thumb photoId={i.imageId} name={i.typeName} className="size-9" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/equipment/${i.id}`} className="block truncate text-sm font-medium hover:underline">
                      {i.typeName}
                    </Link>
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                      <Mono>{i.serialNumber ? `SN ${i.serialNumber}` : i.units > 1 ? `${i.units} pcs · no serial` : "No serial"}</Mono>
                      {i.rentalHouseName && <span>{i.rentalHouseName}</span>}
                      <ConditionBadge condition={i.condition} hideOk />
                    </div>
                  </div>
                  {i.status !== "on_project" && <StatusBadge status={i.status} />}
                  {canEdit &&
                    (i.units > 1 ? (
                      <UnitsButton action={unpackUnitsAction.bind(null, id, i.itemIds)} units={i.units} label="Take out" />
                    ) : (
                      <SmallActionButton action={unpackItemAction.bind(null, id, i.id)} label="Take out" />
                    ))}
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
