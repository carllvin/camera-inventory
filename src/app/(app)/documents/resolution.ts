import type { T } from "@/lib/i18n/core";

/** Labels for document line results; shared by server and client components. */
export const RESOLUTION: Record<string, { label: string; tone: "neutral" | "ok" | "accent" | "warn" | "danger" | "info" }> = {
  pending: { label: "Choose type", tone: "warn" },
  match_existing: { label: "Known item", tone: "info" },
  create_new: { label: "New item", tone: "ok" },
  ignore: { label: "Ignored", tone: "neutral" },
  discrepancy: { label: "Conflict", tone: "danger" },
  create_set: { label: "Becomes a set", tone: "accent" },
};

/** Return notes use different words for the same states. */
export const RETURN_RESOLUTION: Record<string, { label: string; tone: "neutral" | "ok" | "accent" | "warn" | "danger" | "info" }> = {
  ...RESOLUTION,
  pending: { label: "Choose item", tone: "warn" },
  match_existing: { label: "Returning", tone: "ok" },
};

/** The label of a line result in the user's language. */
export function resolutionText(t: T, label: string): string {
  switch (label) {
    case "Choose type":
      return t("Choose type");
    case "Known item":
      return t("Known item");
    case "New item":
      return t("New item");
    case "Ignored":
      return t("Ignored");
    case "Conflict":
      return t("Conflict");
    case "Becomes a set":
      return t("Becomes a set");
    case "Choose item":
      return t("Choose item");
    case "Returning":
      return t("Returning");
    default:
      return label;
  }
}
