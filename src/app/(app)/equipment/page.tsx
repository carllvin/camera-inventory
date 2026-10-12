import { Minus, Plus } from "lucide-react";
import { getProjectSummary } from "@/server/domain/projects";
import { UUID_RE } from "@/server/pages";
import { EquipmentBrowser, type BrowserParams } from "@/components/equipment-browser";
import { bulkEquipmentAction } from "../projects/actions";
import { Tabs, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { getCategoryTree } from "@/server/domain/categories";
import { listCases } from "@/server/domain/cases";
import { hasRole } from "@/server/domain/context";
import { listItems, type ItemFilters } from "@/server/domain/equipment-items";
import { listRentalHouses } from "@/server/domain/rental-houses";
import { getCurrentProject } from "@/server/current-project";
import { getT } from "@/server/i18n";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Equipment") };
}

const LIMIT = 500;

type SP = BrowserParams & { projectId?: string };

export default async function EquipmentPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const t = await getT();
  const db = getDb();
  // A project's Equipment tab passes ?projectId=; otherwise the project chosen in the top bar
  // scopes the list ("All projects" there shows everything).
  const { current, active } = await getCurrentProject();
  const fromUrl = sp.projectId && UUID_RE.test(sp.projectId) ? await getProjectSummary(db, ctx, sp.projectId) : null;
  const project = fromUrl ? { id: fromUrl.project.id, name: fromUrl.project.name, status: fromUrl.project.status } : current ? { id: current.id, name: current.name, status: active.find((p) => p.id === current.id)?.status ?? "prep" } : null;
  const projectId = project?.id;
  const { view: _view, sort: _sort, select: _select, projectId: _p, ...filterParams } = sp;
  const [items, { flat: categories }, rentalHouses, cases] = await Promise.all([
    listItems(db, ctx, { ...(filterParams as ItemFilters), projectId, limit: LIMIT }),
    getCategoryTree(db, ctx),
    listRentalHouses(db, ctx),
    projectId ? listCases(db, ctx, { projectId }) : Promise.resolve([]),
  ]);
  const hasFilters = Object.values(filterParams).some(Boolean);
  return (
    <>
      <PageHeader
        title={project ? t("Equipment · {project}", { project: project.name }) : t("Equipment")}
        subtitle={project ? (fromUrl ? t("Equipment on this project") : t("Equipment on the project chosen in the top bar")) : t("Every physical item, across all projects and rental houses")}
        back={fromUrl ? { href: `/projects/${fromUrl.project.id}`, label: fromUrl.project.name } : undefined}
        actions={
          hasRole(ctx, "member") &&
          (project ? (
            <>
              {project.status !== "closed" && (
                <LinkButton href={`/projects/${project.id}/add-equipment`} variant="primary">
                  <Plus className="size-4" /> {t("Add equipment")}
                </LinkButton>
              )}
              {items.length > 0 && (
                <LinkButton href={`/projects/${project.id}/remove`}>
                  <Minus className="size-4" /> {t("Remove")}
                </LinkButton>
              )}
            </>
          ) : (
            <LinkButton href="/equipment/new" variant="primary">
              <Plus className="size-4" /> {t("Add equipment")}
            </LinkButton>
          ))
        }
      />
      <Tabs
        active="items"
        tabs={[
          { key: "items", href: "/equipment", label: t("Items") },
          { key: "types", href: "/equipment/types", label: t("Equipment types") },
        ]}
      />
      <EquipmentBrowser
        basePath="/equipment"
        sp={sp}
        items={items}
        limit={LIMIT}
        projectId={projectId}
        categories={categories}
        rentalHouses={rentalHouses}
        cases={cases}
        hasFilters={hasFilters}
        bulkAction={projectId && hasRole(ctx, "member") ? bulkEquipmentAction.bind(null, projectId) : undefined}
        empty={
          project ? (
            <EmptyState
              title={t("No equipment on this project yet")}
              action={hasRole(ctx, "member") && project.status !== "closed" && <LinkButton href={`/projects/${project.id}/add-equipment`} variant="primary">{t("Add equipment")}</LinkButton>}
            >
              {t("Upload a delivery note, add equipment from the database or create new items.")}
            </EmptyState>
          ) : (
            <EmptyState title={t("No equipment yet")} action={hasRole(ctx, "member") && <LinkButton href="/equipment/new" variant="primary">{t("Add equipment")}</LinkButton>} />
          )
        }
      />
    </>
  );
}
