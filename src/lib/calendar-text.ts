/**
 * Calendar entries as text, shared by the calendar page, the subscription (ICS)
 * and the daily reminder, so all three say the same thing in the user's language.
 */
import type { CalEvent } from "@/server/domain/calendar";

type T = (text: string, params?: Record<string, string | number>) => string;
type TN = (name: string) => string;
type F = { formatDate: (d: string) => string };

const pieces = (t: T, n: number) => (n === 1 ? t("1 piece") : t("{n} pieces", { n }));

export function eventTitle(e: CalEvent, t: T, tn: TN, f: F): string {
  switch (e.kind) {
    case "due": {
      const what = e.house ? t("{pieces} to {house}", { pieces: pieces(t, e.units), house: e.house }) : pieces(t, e.units);
      return e.overdue ? t("Overdue: {what}", { what }) : t("Return: {what}", { what });
    }
    case "project_start":
      return t("Project starts");
    case "project_end":
      return t("Project ends");
    case "delivery":
      return e.house ? t("Delivery from {house}", { house: e.house }) : t("Delivery");
    case "return_note":
      return e.house ? t("Returned to {house}", { house: e.house }) : t("Returned");
    case "need":
      return t("Extra: {n} × {label} until {date}", { n: e.quantity, label: tn(e.label), date: f.formatDate(e.until) });
    case "order":
      return t("Order: {n} × {label} for {date}", { n: e.quantity, label: tn(e.label), date: f.formatDate(e.needFrom) });
  }
}

export function eventHref(e: CalEvent): string {
  switch (e.kind) {
    case "due":
      return e.items.length === 1 ? `/equipment/${e.items[0]!.id}` : `/projects/${e.projectId}`;
    case "delivery":
    case "return_note":
      return `/documents/${e.documentId}`;
    case "need":
    case "order":
      return `/projects/${e.projectId}/plan`;
    default:
      return `/projects/${e.projectId}`;
  }
}

export type EventTone = "danger" | "warn" | "plan" | "doc" | "project";
export function eventTone(e: CalEvent, today: string): EventTone {
  if (e.kind === "due") return e.overdue || e.date < today ? "danger" : "warn";
  if (e.kind === "order" || e.kind === "need") return "plan";
  if (e.kind === "delivery" || e.kind === "return_note") return "doc";
  return "project";
}
