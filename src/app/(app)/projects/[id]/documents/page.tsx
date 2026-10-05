import { DocumentList } from "@/components/document-list";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { listDocuments } from "@/server/domain/overview";

export default async function ProjectDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const documents = await listDocuments(getDb(), await getCtx(), { projectId: id });
  return <DocumentList documents={documents} showProject={false} />;
}
