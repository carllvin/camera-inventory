/** Labels for document line results; shared by server and client components. */
export const RESOLUTION: Record<string, { label: string; tone: "neutral" | "ok" | "accent" | "warn" | "danger" | "info" }> = {
  pending: { label: "Choose type", tone: "warn" },
  match_existing: { label: "Known item", tone: "info" },
  create_new: { label: "New item", tone: "ok" },
  ignore: { label: "Ignored", tone: "neutral" },
  discrepancy: { label: "Conflict", tone: "danger" },
};
