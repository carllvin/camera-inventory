import { FileDown, FileUp, ListChecks } from "lucide-react";
import { DocumentList } from "@/components/document-list";
import { LinkButton, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { getCurrentProject } from "@/server/current-project";
import { FilterBar, FilterSelect } from "@/components/filters";
import { DOCUMENT_SORTS, sortDocuments } from "@/lib/sorting";
import { listDocuments } from "@/server/domain/overview";
import { getT } from "@/server/i18n";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Documents") };
}

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  const { sort } = await searchParams;
  const ctx = await getCtx();
  const { current } = await getCurrentProject();
  const t = await getT();
  const documents = sortDocuments(await listDocuments(getDb(), ctx, { projectId: current?.id }), sort);
  const SORT_LABEL: Record<string, string> = { open: t("Sort: open first"), number: t("Sort: number"), oldest: t("Sort: oldest first") };
  return (
    <>
      <PageHeader
        title={t("Documents")}
        subtitle={current ? t("Delivery and return notes and lists of {project}", { project: current.name }) : t("Delivery and return notes and current lists")}
        actions={
          hasRole(ctx, "member") && (
            <>
              <LinkButton href="/documents/new" variant="primary">
                <FileUp className="size-4" /> {t("Delivery note")}
              </LinkButton>
              <LinkButton href="/documents/new?kind=return_note">
                <FileDown className="size-4" /> {t("Return note")}
              </LinkButton>
              <LinkButton href="/documents/new?kind=inventory_list">
                <ListChecks className="size-4" /> {t("Current list")}
              </LinkButton>
            </>
          )
        }
      />
      {documents.length > 1 && (
        <FilterBar hasFilters={false}>
          <FilterSelect name="sort" label={t("Sort")} allLabel={t("Sort: newest first")} value={sort} options={DOCUMENT_SORTS.map((o) => ({ value: o.value, label: SORT_LABEL[o.value] ?? o.label }))} />
        </FilterBar>
      )}
      <DocumentList documents={documents} showProject={!current} />
    </>
  );
}
