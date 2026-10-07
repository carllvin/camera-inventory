import { FileDown, FileUp, ListChecks } from "lucide-react";
import { DocumentList } from "@/components/document-list";
import { LinkButton, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { getCurrentProject } from "@/server/current-project";
import { listDocuments } from "@/server/domain/overview";

export const metadata = { title: "Documents" };

export default async function DocumentsPage() {
  const ctx = await getCtx();
  const { current } = await getCurrentProject();
  const documents = await listDocuments(getDb(), ctx, { projectId: current?.id });
  return (
    <>
      <PageHeader
        title="Documents"
        subtitle={current ? `Delivery and return notes and lists of ${current.name}` : "Delivery and return notes and current lists"}
        actions={
          hasRole(ctx, "member") && (
            <>
              <LinkButton href="/documents/new" variant="primary">
                <FileUp className="size-4" /> Delivery note
              </LinkButton>
              <LinkButton href="/documents/new?kind=return_note">
                <FileDown className="size-4" /> Return note
              </LinkButton>
              <LinkButton href="/documents/new?kind=inventory_list">
                <ListChecks className="size-4" /> Current list
              </LinkButton>
            </>
          )
        }
      />
      <DocumentList documents={documents} showProject={!current} />
    </>
  );
}
