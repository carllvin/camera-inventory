import { FileUp } from "lucide-react";
import { DocumentList } from "@/components/document-list";
import { LinkButton } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { listDocuments } from "@/server/domain/overview";

export default async function ProjectDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  const documents = await listDocuments(getDb(), ctx, { projectId: id });
  return (
    <>
      {hasRole(ctx, "member") && (
        <div className="mb-3 flex justify-end">
          <LinkButton href={`/documents/new?projectId=${id}`} variant="primary">
            <FileUp className="size-4" /> Upload delivery note
          </LinkButton>
        </div>
      )}
      <DocumentList documents={documents} showProject={false} />
    </>
  );
}
