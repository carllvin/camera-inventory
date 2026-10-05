/** Display helpers shared by server and client components. */

export const STATUS_LABEL: Record<string, string> = {
  available: "Available",
  on_project: "On project",
  in_use: "In use",
  ready_for_return: "Ready for return",
  missing: "Missing",
  returned: "Returned",
};

export const CONDITION_LABEL: Record<string, string> = {
  unknown: "Unknown",
  ok: "OK",
  minor_wear: "Minor wear",
  damaged: "Damaged",
  defective: "Defective",
};

export const PROJECT_STATUS_LABEL: Record<string, string> = {
  planning: "Planning",
  prep: "Prep",
  shooting: "Shooting",
  wrap: "Wrap",
  closed: "Closed",
};

export const ISSUE_TYPE_LABEL: Record<string, string> = {
  missing: "Missing",
  damaged: "Damaged",
  serial_conflict: "Serial conflict",
  ai_conflict: "AI conflict",
  return_mismatch: "Return mismatch",
  delivery_mismatch: "Delivery mismatch",
  other: "Other",
};

export const DOCUMENT_KIND_LABEL: Record<string, string> = {
  delivery_note: "Delivery note",
  return_note: "Return note",
  other: "Document",
};

export const DOCUMENT_STATUS_LABEL: Record<string, string> = {
  uploaded: "Uploaded",
  processing: "Processing",
  extracted: "Needs review",
  confirmed: "Confirmed",
  failed: "Failed",
  discarded: "Discarded",
};

export const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member", viewer: "Viewer" };

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Europe/Berlin";

export function formatDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d) : d;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: TZ }).format(date);
}

export function formatDateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  }).format(date);
}

export function formatRelative(d: Date | string, now = new Date()) {
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = (now.getTime() - date.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
  return formatDate(date);
}

export function dateRange(start: string | null, end: string | null) {
  if (!start && !end) return null;
  return `${formatDate(start)} – ${formatDate(end)}`;
}

export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}
