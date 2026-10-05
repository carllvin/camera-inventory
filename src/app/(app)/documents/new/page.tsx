import { Card, NoPermission, PageHeader } from "@/components/ui";
import { getExtractor } from "@/server/ai";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { listProjectOptions } from "@/server/domain/projects";
import { listRentalHouses } from "@/server/domain/rental-houses";
import { UUID_RE } from "@/server/pages";
import { UploadForm } from "../upload-form";

export const metadata = { title: "Upload delivery note" };

export default async function NewDocumentPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const ctx = await getCtx();
  if (!hasRole(ctx, "member")) return <NoPermission />;
  const db = getDb();
  const [projects, houses] = await Promise.all([listProjectOptions(db, ctx, { activeOnly: true }), listRentalHouses(db, ctx)]);
  const defaultProjectId = projectId && UUID_RE.test(projectId) ? projectId : projects.length === 1 ? projects[0]!.id : undefined;
  return (
    <>
      <PageHeader
        title="Upload delivery note"
        subtitle="Photos or PDF of the rental house’s delivery note (Lieferschein)"
        back={defaultProjectId ? { href: `/projects/${defaultProjectId}/documents`, label: "Project documents" } : { href: "/documents", label: "Documents" }}
      />
      <Card className="max-w-2xl p-5">
        <UploadForm
          kind="delivery_note"
          projects={projects.map((p) => ({ value: p.id, label: p.name }))}
          rentalHouses={houses.map((r) => ({ value: r.id, label: r.name }))}
          defaultProjectId={defaultProjectId}
          aiAvailable={getExtractor().available}
        />
      </Card>
    </>
  );
}
