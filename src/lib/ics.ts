/** Minimal iCalendar (RFC 5545) writer for all-day events. */
export interface IcsEvent {
  uid: string;
  /** YYYY-MM-DD; `end` is the last day (inclusive). */
  start: string;
  end?: string;
  summary: string;
  description?: string;
  url?: string;
  /** Remind at 09:00 the day before. */
  alarm?: boolean;
}

const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const day = (iso: string) => iso.replaceAll("-", "");
function nextDay(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Lines longer than 75 octets are folded (continuation lines start with a space). */
function fold(line: string) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, "utf8") > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
    }
    cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function buildIcs(name: string, events: IcsEvent[], now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Camera Inventory//Calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${esc(name)}`, "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day(e.start)}`,
      `DTEND;VALUE=DATE:${day(nextDay(e.end ?? e.start))}`,
      `SUMMARY:${esc(e.summary)}`,
      "TRANSP:TRANSPARENT",
    );
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (e.alarm) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(e.summary)}`, "TRIGGER:-PT15H", "END:VALARM");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
