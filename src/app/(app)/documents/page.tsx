import { DocumentList } from "@/components/document-list";
import { PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { listDocuments } from "@/server/domain/overview";

export const metadata = { title: "Documents" };

export default async function DocumentsPage() {
  const documents = await listDocuments(getDb(), await getCtx());
  return (
    <>
      <PageHeader title="Documents" subtitle="Delivery and return notes" />
      <DocumentList documents={documents} />
    </>
  );
}
