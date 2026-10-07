import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Box,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  FileText,
  Pencil,
  Plus,
  Sparkles,
  Split,
  Wrench,
} from "lucide-react";
import { activityTone, groupActivity } from "@/lib/activity-groups";
import { cn, dayLabel, formatDateTime, formatTime } from "@/lib/format";
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
  correlationId?: string | null;
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

const TONE: Record<ReturnType<typeof activityTone>, string> = {
  ok: "bg-ok/15 text-ok",
  info: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  danger: "bg-danger/15 text-danger",
  warn: "bg-warn/15 text-warn",
  set: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  neutral: "bg-surface-2 text-muted",
};

function Dot({ e, small }: { e: ActivityEvent; small?: boolean }) {
  const Icon = e.actorType === "ai" ? Sparkles : iconFor(e.action);
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-full", small ? "size-5" : "size-7", e.actorType === "ai" ? TONE.set : TONE[activityTone(e)])}>
      <Icon className={small ? "size-3" : "size-3.5"} aria-hidden />
    </span>
  );
}

function Details({ e, showProject, compact }: { e: ActivityEvent; showProject: boolean; compact: boolean }) {
  const note = (e.metadata?.note ?? e.metadata?.reason) as string | undefined;
  return (
    <div className="space-y-1 text-xs text-muted">
      {note && <p className="italic">“{note}”</p>}
      <p>
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
        {e.equipmentItemId && !compact && (
          <>
            {" · "}
            <Link href={`/equipment/${e.equipmentItemId}`} className="hover:underline">
              equipment
            </Link>
          </>
        )}
      </p>
      {e.undo === "done" && <p>Undone</p>}
      {e.undo === "can" && <UndoButton action={undoEventAction.bind(null, e.id)} label={e.summary} />}
    </div>
  );
}

/**
 * History, compact: one line per entry (colour-coded), grouped by day; tap a line
 * for details and Undo. Everything one operation did is one entry ("+12 more").
 */
export function ActivityList({ events, showProject = true, compact = false }: { events: ActivityEvent[]; showProject?: boolean; compact?: boolean }) {
  if (events.length === 0) return <p className="px-4 py-6 text-sm text-muted">No history yet.</p>;
  const days = groupActivity(events, (d) => dayLabel(d));
  return (
    <div>
      {days.map(({ day, groups }) => (
        <section key={day} aria-label={day}>
          <h3 className="bg-surface-2/50 px-4 py-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{day}</h3>
          <ol className="divide-y divide-border/60">
            {groups.map(({ head, rest }) => (
              <li key={head.id}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2 hover:bg-surface-2/60 [&::-webkit-details-marker]:hidden">
                    <Dot e={head} />
                    <span className={cn("min-w-0 flex-1 text-sm", head.undo === "done" && "text-muted line-through decoration-muted/60")}>
                      <span className="line-clamp-2">{head.summary}</span>
                      {rest.length > 0 && <span className="text-xs text-muted">+{rest.length} more</span>}
                    </span>
                    <time className="shrink-0 text-xs text-muted tabular-nums" dateTime={new Date(head.occurredAt).toISOString()}>
                      {formatTime(head.occurredAt)}
                    </time>
                    <ChevronRight className="size-3.5 shrink-0 text-muted transition-transform group-open:rotate-90" aria-hidden />
                  </summary>
                  <div className="space-y-2 pr-4 pb-3 pl-14">
                    <Details e={head} showProject={showProject} compact={compact} />
                    {rest.length > 0 && (
                      <ul className="space-y-1.5 border-l border-border pl-3">
                        {rest.map((e) => (
                          <li key={e.id} className="flex items-start gap-2">
                            <Dot e={e} small />
                            <div className="min-w-0 flex-1">
                              <p className={cn("text-sm", e.undo === "done" && "text-muted line-through")}>
                                {e.equipmentItemId && !compact ? (
                                  <Link href={`/equipment/${e.equipmentItemId}`} className="hover:underline">
                                    {e.summary}
                                  </Link>
                                ) : (
                                  e.summary
                                )}
                              </p>
                              {e.undo === "can" && <UndoButton action={undoEventAction.bind(null, e.id)} label={e.summary} />}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </details>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
