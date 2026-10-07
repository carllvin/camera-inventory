/** Days between two ISO dates (YYYY-MM-DD), counted in whole calendar days. */
function days(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Where the project stands in its rental period, for the dashboard header:
 * "Starts in 3 days", "Day 4 of 21 · 17 days left", "Ends today", "Ended 2 days ago".
 * `tone` is "warn" when the end (= return) is close or past.
 */
export function projectTimeline(start: string | null, end: string | null, today: string): { text: string; tone: "neutral" | "warn" | "danger" } | null {
  if (start && days(today, start) > 0) {
    const n = days(today, start);
    return { text: n === 1 ? "Starts tomorrow" : `Starts in ${plural(n, "day")}`, tone: "neutral" };
  }
  if (end) {
    const left = days(today, end);
    if (left < 0) return { text: `Ended ${plural(-left, "day")} ago — equipment still out?`, tone: "danger" };
    if (left === 0) return { text: "Ends today", tone: "warn" };
    const day = start ? days(start, today) + 1 : null;
    const total = start ? days(start, end) + 1 : null;
    const prefix = day && total ? `Day ${day} of ${total} · ` : "";
    return { text: `${prefix}${left === 1 ? "ends tomorrow" : `${plural(left, "day")} left`}`, tone: left <= 2 ? "warn" : "neutral" };
  }
  if (start) return { text: `Day ${days(start, today) + 1}`, tone: "neutral" };
  return null;
}
