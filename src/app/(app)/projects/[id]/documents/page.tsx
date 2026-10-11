import { FileDown, FileUp, ListChecks } from "lucide-react";
import { DocumentList } from "@/components/document-list";
import { LinkButton } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { listDocuments } from "@/server/domain/overview";
import { getT } from "@/server/i18n";

export default async function ProjectDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  const t = await getT();
  const documents = await listDocuments(getDb(), ctx, { projectId: id });
  return (
    <>
      {hasRole(ctx, "member") && (
        <div className="mb-3 flex flex-wrap justify-end gap-2">
          <LinkButton href={`/documents/new?projectId=${id}`} variant="primary">
            <FileUp className="size-4" /> {t("Delivery note")}
          </LinkButton>
          <LinkButton href={`/documents/new?kind=return_note&projectId=${id}`}>
            <FileDown className="size-4" /> {t("Return note")}
          </LinkButton>
          <LinkButton href={`/documents/new?kind=inventory_list&projectId=${id}`}>
            <ListChecks className="size-4" /> {t("Current list")}
          </LinkButton>
        </div>
      )}
      <DocumentList documents={documents} showProject={false} />
    </>
  );
}
