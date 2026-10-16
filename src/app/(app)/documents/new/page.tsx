import { Card, NoPermission, PageHeader } from "@/components/ui";
import { getExtractor } from "@/server/ai";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { listProjectOptions } from "@/server/domain/projects";
import { listRentalHouses } from "@/server/domain/rental-houses";
import { getT } from "@/server/i18n";
import { UUID_RE } from "@/server/pages";
import { UploadForm } from "../upload-form";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Upload document") };
}

export default async function NewDocumentPage({ searchParams }: { searchParams: Promise<{ projectId?: string; kind?: string }> }) {
  const { projectId, kind: kindParam } = await searchParams;
  const kind = kindParam === "return_note" || kindParam === "inventory_list" ? kindParam : "delivery_note";
  const isReturn = kind === "return_note";
  const isList = kind === "inventory_list";
  const ctx = await getCtx();
  const t = await getT();
  if (!hasRole(ctx, "member")) return <NoPermission />;
  const db = getDb();
  const [projects, houses] = await Promise.all([listProjectOptions(db, ctx, { activeOnly: true }), listRentalHouses(db, ctx)]);
  const aiAvailable = getExtractor().available;
  // With AI reading the project is detected from the document unless one was passed in.
  const defaultProjectId = projectId && UUID_RE.test(projectId) ? projectId : !aiAvailable && projects.length === 1 ? projects[0]!.id : undefined;
  return (
    <>
      <PageHeader
        title={isList ? t("Upload current list") : isReturn ? t("Upload return note") : t("Upload delivery note")}
        subtitle={
          isList
            ? t("The rental house’s list of everything the production has right now (Mietliste / Bestandsliste) — compared with the database, differences can be added or removed")
            : isReturn
              ? t("Photos or PDF of the return note (Rücklieferschein) — equipment going back to a rental house")
              : t("Photos or PDF of the rental house’s delivery note (Lieferschein)")
        }
        back={defaultProjectId ? { href: `/projects/${defaultProjectId}/documents`, label: t("Project documents") } : { href: "/documents", label: t("Documents") }}
      />
      <Card className="max-w-2xl p-5">
        <UploadForm
          kind={kind}
          projects={projects.map((p) => ({ value: p.id, label: p.name }))}
          rentalHouses={houses.map((r) => ({ value: r.id, label: r.name }))}
          defaultProjectId={defaultProjectId}
          aiAvailable={aiAvailable}
          aiBatch={aiAvailable && getExtractor().supportsBatch === true}
        />
      </Card>
    </>
  );
}
