import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Box,
  CircleAlert,
  CircleCheck,
  FileText,
  Pencil,
  Plus,
  Sparkles,
  Split,
  Wrench,
} from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { undoEventAction } from "@/app/(app)/history-actions";
import { UndoButton } from "./undo-button";

export interface ActivityEvent {
  id: number;
  occurredAt: Date;
  action: string;
  summary: string;
  actorType: string;
  actorName: string | null;
  projectId?: string | null;
  projectName?: string | null;
  equipmentItemId?: string | null;
  documentId?: string | null;
  changes?: Record<string, { from: unknown; to: unknown }> | null;
  metadata?: Record<string, unknown> | null;
  /** "can": show Undo; "done": this change was undone. */
  undo?: "can" | "done" | null;
}

function iconFor(action: string) {
  if (action.endsWith(".created")) return Plus;
  if (action.includes("assigned_to_project") || action === "delivery.imported") return ArrowDownToLine;
  if (action.includes("returned") || action === "return_note.imported" || action.includes("removed_from_project")) return ArrowUpFromLine;
  if (action.includes("case")) return Box;
  if (action.includes("condition")) return Wrench;
  if (action.includes("split")) return Split;
  if (action.startsWith("issue.resolved")) return CircleCheck;
  if (action.startsWith("issue")) return CircleAlert;
  if (action.startsWith("document")) return FileText;
  return Pencil;
}

/** Vertical timeline of audit events. */
export function ActivityList({ events, showProject = true, compact = false }: { events: ActivityEvent[]; showProject?: boolean; compact?: boolean }) {
  if (events.length === 0) return <p className="px-4 py-6 text-sm text-muted">No history yet.</p>;
  return (
    <ol className="relative">
      {events.map((e) => {
        const Icon = e.actorType === "ai" ? Sparkles : iconFor(e.action);
        const note = (e.metadata?.note ?? e.metadata?.reason) as string | undefined;
        return (
          <li key={e.id} className="relative flex gap-3 px-4 py-2.5">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-muted">
              <Icon className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className={e.undo === "done" ? "text-sm text-muted line-through decoration-muted/60" : "text-sm"}>
                {e.equipmentItemId && !compact ? (
                  <Link href={`/equipment/${e.equipmentItemId}`} className="hover:underline">
                    {e.summary}
                  </Link>
                ) : (
                  e.summary
                )}
              </p>
              {note && <p className="mt-0.5 text-xs text-muted italic">“{note}”</p>}
              {e.undo === "done" && <p className="mt-0.5 text-xs text-muted">Undone</p>}
              <p className="mt-0.5 text-xs text-muted">
                {formatDateTime(e.occurredAt)} · {e.actorType === "ai" ? "AI" : e.actorType === "system" ? "System" : (e.actorName ?? "Unknown")}
                {showProject && e.projectId && e.projectName && (
                  <>
                    {" · "}
                    <Link href={`/projects/${e.projectId}`} className="hover:underline">
                      {e.projectName}
                    </Link>
                  </>
                )}
                {e.documentId && (
                  <>
                    {" · "}
                    <Link href={`/documents/${e.documentId}`} className="hover:underline">
                      document
                    </Link>
                  </>
                )}
              </p>
            </div>
            {e.undo === "can" && (
              <div className="shrink-0">
                <UndoButton action={undoEventAction.bind(null, e.id)} label={e.summary} />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
