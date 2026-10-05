import { FileUp } from "lucide-react";
import { DocumentList } from "@/components/document-list";
import { LinkButton, PageHeader } from "@/components/ui";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { hasRole } from "@/server/domain/context";
import { listDocuments } from "@/server/domain/overview";

export const metadata = { title: "Documents" };

export default async function DocumentsPage() {
  const ctx = await getCtx();
  const documents = await listDocuments(getDb(), ctx);
  return (
    <>
      <PageHeader
        title="Documents"
        subtitle="Delivery and return notes"
        actions={hasRole(ctx, "member") && <LinkButton href="/documents/new" variant="primary"><FileUp className="size-4" /> Upload delivery note</LinkButton>}
      />
      <DocumentList documents={documents} />
    </>
  );
}
