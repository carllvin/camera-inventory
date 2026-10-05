import { EmptyState, LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <EmptyState title="Not found" action={<LinkButton href="/">Back to dashboard</LinkButton>}>
      This page does not exist, or it belongs to another workspace.
    </EmptyState>
  );
}
