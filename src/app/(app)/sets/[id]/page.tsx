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

        {/* One place for the set's contents: what is expected, what is packed (and can be taken out), and packing more. */}
        <Card className="min-w-0">
          <CardHeader
            title={`Contents (${packedPieces} packed)`}
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
          ) : (
            <>
              {canEdit && (
                <div className="border-b border-border p-4">
                  <PackByCode action={packByCodeAction.bind(null, id)} />
                </div>
              )}

              {cmp.lines.length === 0 && (
                <div className="space-y-3 border-b border-border px-4 py-4 text-sm text-muted">
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
              )}

              {/* Expected lines, each with the pieces packed for it. */}
              {cmp.lines.length > 0 && (
                <ul className="divide-y divide-border">
                  {cmp.lines.map((r) => {
                    const ok = r.missing === 0;
                    return (
                      <li key={r.line.id} className="px-4 py-2.5">
                        <div className="flex items-center gap-3">
                          {ok ? <CircleCheck className="size-4 shrink-0 text-ok" aria-label="Complete" /> : <CircleAlert className="size-4 shrink-0 text-warn" aria-label="Incomplete" />}
                          <Thumb photoId={lineImage.get(r.line.id) ?? null} name={r.line.label} className="size-9" />
                          <span className="min-w-0 flex-1 text-sm font-medium">{r.line.label}</span>
                          <span className={cn("text-sm tabular-nums", ok ? "text-muted" : "font-semibold text-warn")}>
                            {r.matched} / {r.line.quantity}
                          </span>
                        </div>
                        {(r.items.length > 0 || !ok) && (
                          <ul className="mt-1 ml-7 space-y-1 border-l border-border pl-3">
                            {r.items.map((x) => (
                              <PackedPiece key={x.id} caseId={id} canEdit={canEdit} item={byId.get(x.id)!} units={x.units} />
                            ))}
                            {!ok && <li className="text-xs text-warn">{r.missing} missing — pack from the project below</li>}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* Packed but not expected (or everything, while nothing is expected). */}
              {(cmp.lines.length === 0 ? d.items.length > 0 : cmp.extras.length > 0) && (
                <div className={cn("border-t border-border px-4 py-3", cmp.lines.length > 0 && "bg-danger/5")}>
                  {cmp.lines.length > 0 && <h3 className="mb-1 text-xs font-semibold tracking-wide text-danger uppercase">Not expected in this set</h3>}
                  <ul className="space-y-1">
                    {cmp.lines.length === 0
                      ? packedRows.map((i) => <PackedPiece key={i.id} caseId={id} canEdit={canEdit} item={i} units={i.units} itemIds={i.itemIds} withName />)
                      : cmp.extras.map((e) => <PackedPiece key={e.id} caseId={id} canEdit={canEdit} item={byId.get(e.id)!} units={e.units} withName />)}
                  </ul>
                </div>
              )}
              {cmp.lines.length === 0 && d.items.length === 0 && <p className="px-4 py-4 text-sm text-muted">Nothing packed yet.</p>}

              {canEdit && (
                <div className="border-t border-border p-4">
                  <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Add from the project</h3>
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
              )}
            </>
          )}
        </Card>

        <div className="min-w-0 space-y-6">
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

type PackedItem = Awaited<ReturnType<typeof getCaseDetail>>["items"][number];

/** One packed piece (or several units without serial): identifiers, state, "Take out". */
function PackedPiece({ caseId, canEdit, item, units, itemIds, withName = false }: { caseId: string; canEdit: boolean; item: PackedItem; units: number; itemIds?: string[]; withName?: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {withName && <Thumb photoId={item.imageId} name={item.typeName} className="size-8" />}
      <Link href={`/equipment/${item.id}`} className="min-w-0 flex-1 hover:underline">
        {withName && <span className="mr-2 font-medium">{item.typeName}</span>}
        <span className="text-xs text-muted">
          <Mono>{item.serialNumber ? `SN ${item.serialNumber}` : units > 1 ? `${units} pcs · no serial` : "No serial"}</Mono>
        </span>
        {item.rentalHouseName && <span className="ml-2 text-xs text-muted">{item.rentalHouseName}</span>}
      </Link>
      <ConditionBadge condition={item.condition} hideOk />
      {item.status !== "on_project" && <StatusBadge status={item.status} />}
      {canEdit &&
        (units > 1 ? (
          <UnitsButton action={unpackUnitsAction.bind(null, caseId, itemIds ?? [item.id])} units={units} label="Take out" />
        ) : (
          <SmallActionButton action={unpackItemAction.bind(null, caseId, item.id)} label="Take out" />
        ))}
    </li>
  );
}
