/** Summaries of whole operations: when present they head the group. */
const HEADLINES = ["delivery.imported", "return_note.imported", "catalog.imported", "document.confirmed", "case.created", "case.archived"];

type Groupable = { id: number; occurredAt: Date | string; correlationId?: string | null; action: string };

/**
 * One entry per operation: consecutive events that share a correlation id (a confirmed
 * delivery, a packed checklist, a removal …) become one group headed by its summary
 * event; everything else stays a group of one. Groups are bucketed by day.
 */
export function groupActivity<T extends Groupable>(events: T[], dayOf: (d: Date | string) => string) {
  const groups: { head: T; rest: T[] }[] = [];
  for (const e of events) {
    const last = groups[groups.length - 1];
    if (last && e.correlationId && last.head.correlationId === e.correlationId) {
      // A summary event found later in the group takes the lead.
      if (HEADLINES.includes(e.action) && !HEADLINES.includes(last.head.action)) {
        last.rest.unshift(last.head);
        last.head = e;
      } else last.rest.push(e);
      continue;
    }
    groups.push({ head: e, rest: [] });
  }
  const days: { day: string; groups: typeof groups }[] = [];
  for (const g of groups) {
    const day = dayOf(g.head.occurredAt);
    const bucket = days[days.length - 1];
    if (bucket && bucket.day === day) bucket.groups.push(g);
    else days.push({ day, groups: [g] });
  }
  return days;
}

type Tone = "ok" | "info" | "danger" | "warn" | "set" | "neutral";

/** Colour code of a history entry: arrivals green, returns blue, missing/issues red, damage orange, sets purple. */
export function activityTone(e: { action: string; changes?: Record<string, { from: unknown; to: unknown }> | null }): Tone {
  const a = e.action;
  const to = (k: string) => e.changes?.[k]?.to;
  if (a === "equipment_item.status_changed") return to("status") === "missing" ? "danger" : to("status") === "ready_for_return" ? "info" : "neutral";
  if (a === "equipment_item.condition_changed") return to("condition") === "defective" ? "danger" : to("condition") === "damaged" || to("condition") === "minor_wear" ? "warn" : "ok";
  if (a.startsWith("issue.")) return a === "issue.resolved" || a === "issue.dismissed" ? "ok" : "danger";
  if (a === "equipment_item.assigned_to_project" || a === "delivery.imported" || a === "equipment_item.created" || a === "document.confirmed") return "ok";
  if (a === "equipment_item.returned" || a === "return_note.imported" || a === "equipment_item.removed_from_project") return "info";
  if (a.startsWith("case.") || a.includes("_case")) return "set";
  if (a === "equipment_item.split" || a === "equipment_type.archived") return "warn";
  return "neutral";
}
