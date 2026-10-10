import Link from "next/link";
import { Pencil } from "lucide-react";
import { ActivityList } from "@/components/activity";
import { IssueList } from "@/components/issues";
import { PhotoGallery } from "@/components/photo-gallery";
import { TypeImage } from "@/components/type-image";
import { Badge, Card, CardHeader, ConditionBadge, KeyValues, LinkButton, Mono, PageHeader, StatusBadge } from "@/components/ui";
import { DOCUMENT_KIND_LABEL } from "@/lib/format";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { getItemDetail } from "@/server/domain/equipment-items";
import { listCases } from "@/server/domain/cases";
import { withUndo } from "@/server/domain/revert";
import { listPhotos } from "@/server/domain/photos";
import { listProjectOptions } from "@/server/domain/projects";
import { assertUuid, orNotFound } from "@/server/pages";
import { getFormat, getT } from "@/server/i18n";
import { ItemActions } from "../item-actions";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  assertUuid(id);
  const d = await orNotFound(getItemDetail(getDb(), await getCtx(), id));
  return { title: d.label };
}

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  assertUuid(id);
  const ctx = await getCtx();
  const db = getDb();
  const [t, f] = await Promise.all([getT(), getFormat()]);
  const [d, projects, photos] = await Promise.all([
    orNotFound(getItemDetail(db, ctx, id)),
    listProjectOptions(db, ctx, { activeOnly: true }),
    listPhotos(db, ctx, { equipmentItemId: id }),
  ]);
  const { item, type } = d;
  const timeline = await withUndo(db, ctx, d.timeline as (typeof d.timeline[number] & { changes: Record<string, { from: unknown; to: unknown }> | null; metadata: Record<string, unknown> | null })[]);
  const canEdit = hasRole(ctx, "member");
  const cases = canEdit && item.projectId ? await listCases(db, ctx, { projectId: item.projectId }) : [];
  const [splitBefore, splitAfter] = t("Split from {link}.").split("{link}");
  return (
    <>
      <PageHeader
        back={{ href: item.projectId ? `/projects/${item.projectId}` : "/equipment", label: item.projectId ? d.project?.name ?? t("Project") : t("Equipment") }}
        title={type.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {item.serialNumber && <Mono>{t("SN {sn}", { sn: item.serialNumber })}</Mono>}
            {item.trackingMode === "bulk" && <span>{t("Qty {n}", { n: item.quantity })}</span>}
            <StatusBadge status={item.status} />
            <ConditionBadge condition={item.condition} />
          </span>
        }
        actions={
          canEdit && (
            <LinkButton href={`/equipment/${id}/edit`}>
              <Pencil className="size-4" /> {t("Edit")}
            </LinkButton>
          )
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <Card className="grid gap-5 p-4 sm:grid-cols-[14rem_1fr]">
            <Link href={`/equipment/types/${type.id}`} aria-label={t("Equipment type {name}", { name: type.name })}>
              <TypeImage
                name={type.name}
                photoId={d.referencePhoto?.id}
                // Without a picture a small placeholder on phones, not half a screen of grey.
                className={d.referencePhoto ? undefined : "aspect-auto h-20 sm:aspect-[4/3] sm:h-auto"}
              />
            </Link>
            <KeyValues
              items={[
                { label: t("Model"), value: <Link className="hover:underline" href={`/equipment/types/${type.id}`}>{type.manufacturer} {type.model}</Link> },
                { label: t("Category"), value: d.categoryName },
                { label: t("Serial number"), value: item.serialNumber ? <Mono>{item.serialNumber}</Mono> : null },
                { label: t("Asset number"), value: item.assetNumber ? <Mono>{item.assetNumber}</Mono> : null },
                { label: t("QR / barcode"), value: item.barcode ? <Mono>{item.barcode}</Mono> : null },
                {
                  label: t("Rental house"),
                  value: d.rentalHouse?.id ? <Link className="hover:underline" href={`/settings/rental-houses/${d.rentalHouse.id}`}>{d.rentalHouse.name}</Link> : t("Owned (not rented)"),
                },
                { label: t("Project"), value: d.project?.id ? <Link className="hover:underline" href={`/projects/${d.project.id}`}>{d.project.name}</Link> : t("Not on a project") },
                { label: t("Set"), value: d.case?.id ? <Link className="hover:underline" href={`/sets/${d.case.id}`}>{d.case.name}{d.case.code ? ` (${d.case.code})` : ""}</Link> : null },
                { label: t("Tracking"), value: item.trackingMode === "bulk" ? t("Bulk · {n} units", { n: item.quantity }) : t("Individually tracked") },
              ]}
            />
          </Card>

          {canEdit && (
            <Card className="p-4" aria-label={t("Status, condition and set")}>
              <ItemActions
                itemId={item.id}
                version={item.version}
                status={item.status}
                condition={item.condition}
                projectId={item.projectId}
                projects={projects.map((p) => ({ value: p.id, label: p.name }))}
                quantity={item.trackingMode === "bulk" ? item.quantity : 1}
                caseId={item.caseId}
                cases={cases.map((c) => ({ value: c.id, label: c.code ? `${c.name} (${c.code})` : c.name }))}
              />
            </Card>
          )}

          {d.sameUnits.length > 0 && (
            <Card className="p-4 text-sm">
              <h2 className="mb-1 font-semibold">
                {t("{n} identical units here", { n: item.quantity + d.sameUnits.reduce((n, u) => n + u.quantity, 0) })}
              </h2>
              <p className="text-muted">
                {t("Without a serial number these units are interchangeable. This entry holds {n}; the others:", { n: item.quantity })}{" "}
                {d.sameUnits.map((u, i) => (
                  <span key={u.id}>
                    {i > 0 && ", "}
                    <Link href={`/equipment/${u.id}`} className="text-accent hover:underline">
                      {u.quantity === 1 ? t("1 unit") : t("{n} units", { n: u.quantity })}
                    </Link>
                  </span>
                ))}
                .
              </p>
            </Card>
          )}

          {item.notes && (
            <Card className="p-4">
              <h2 className="mb-1 text-sm font-semibold">{t("Notes")}</h2>
              <p className="text-sm whitespace-pre-wrap">{item.notes}</p>
            </Card>
          )}

          {(d.issues.length > 0 || d.splitChildren.length > 0) && (
            <Card>
              <CardHeader title={t("Issues")} />
              <IssueList issues={d.issues.map((i) => ({ ...i, projectName: null }))} showProject={false} />
            </Card>
          )}

          <PhotoGallery photos={photos} target={{ kind: "item", id }} canEdit={canEdit} />

          <Card>
            <CardHeader title={t("Timeline")} />
            <ActivityList events={timeline} compact subject={d.label} />
          </Card>
        </div>

        <div className="space-y-6">

          <Card>
            <CardHeader title={t("Project history")} />
            {d.assignments.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted">{t("Never on a project.")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {d.assignments.map((a) => (
                  <li key={a.id} className="px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/projects/${a.project_id}`} className="font-medium hover:underline">
                        {a.project_name}
                      </Link>
                      {a.ended_at ? <Badge>{a.end_reason === "returned" ? t("Returned") : a.end_reason === "removed" ? t("Removed") : a.end_reason}</Badge> : <Badge tone="info">{t("Current")}</Badge>}
                    </div>
                    <div className="text-xs text-muted">
                      {f.formatDate(a.assigned_at)} – {a.ended_at ? f.formatDate(a.ended_at) : t("now")}
                      {a.rental_house_name && ` · ${a.rental_house_name}`}
                      {a.quantity > 1 && ` · ${t("{n} units", { n: a.quantity })}`}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
                      {a.delivery_document_id && (
                        <Link href={`/documents/${a.delivery_document_id}`} className="text-muted hover:underline">
                          ↓ {a.delivery_number}
                        </Link>
                      )}
                      {a.return_document_id && (
                        <Link href={`/documents/${a.return_document_id}`} className="text-muted hover:underline">
                          ↑ {a.return_number}
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title={t("Documents")} />
            {d.documents.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted">{t("No linked documents.")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {d.documents.map((doc) => (
                  <li key={doc.id}>
                    <Link href={`/documents/${doc.id}`} className="block px-4 py-2.5 text-sm hover:bg-surface-2">
                      <span className="font-medium">{t(DOCUMENT_KIND_LABEL[doc.kind]!)}</span> <Mono>{doc.document_number}</Mono>
                      <div className="text-xs text-muted">
                        {[doc.rental_house_name, doc.project_name, f.formatDate(doc.document_date)].filter(Boolean).join(" · ")}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {d.splitChildren.length > 0 && (
            <Card className="p-4 text-sm">
              <h2 className="mb-1 font-semibold">{t("Split items")}</h2>
              <ul className="space-y-1">
                {d.splitChildren.map((c) => (
                  <li key={c.id}>
                    <Link href={`/equipment/${c.id}`} className="hover:underline">
                      {t("{n} units", { n: c.quantity })}
                    </Link>{" "}
                    <StatusBadge status={c.status} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {item.splitFromItemId && (
            <p className="text-sm text-muted">
              {splitBefore}
              <Link href={`/equipment/${item.splitFromItemId}`} className="text-accent hover:underline">
                {t("original item")}
              </Link>
              {splitAfter}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
