/** Calendar entries, the ICS subscription and the daily ntfy summary. */
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { buildIcs } from "../src/lib/ics";
import * as s from "../src/server/db/schema";
import { calendarEvents } from "../src/server/domain/calendar";
import type { Ctx } from "../src/server/domain/context";
import { createNeed } from "../src/server/domain/planned-needs";
import { rotateCalendarToken, saveReminderSettings, userByCalendarToken } from "../src/server/domain/reminders";
import { buildDigest } from "../src/server/reminders/digest";
import { runReminderTick } from "../src/server/reminders/run";
import { client, db, itemOnProject, makeFixture } from "./helpers/db";

afterAll(async () => {
  await client.end();
});

describe("ICS", () => {
  it("writes all-day events with escaping, folding and the last day inclusive", () => {
    const ics = buildIcs("Cal", [{ uid: "a@x", start: "2026-11-14", end: "2026-11-16", summary: "Return: 5 pieces, ARRI; test", alarm: true, description: "x".repeat(120) }], new Date("2026-10-10T08:00:00Z"));
    expect(ics).toContain("DTSTART;VALUE=DATE:20261114");
    expect(ics).toContain("DTEND;VALUE=DATE:20261117");
    expect(ics).toContain("SUMMARY:Return: 5 pieces\\, ARRI\\; test");
    expect(ics).toContain("TRIGGER:-PT15H");
    expect(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});

describe("calendar", () => {
  it("groups return dates per day and rental house, shows overdue, plans and orders", async () => {
    const f = await makeFixture();
    const ctx: Ctx = { workspaceId: f.ws.id, userId: f.user.id, role: "owner" };
    await itemOnProject(f, { serialNumber: "C-1", returnDue: "2026-11-02" });
    await itemOnProject(f, { serialNumber: "C-2", returnDue: "2026-11-02" });
    await itemOnProject(f, { serialNumber: "C-3", returnDue: "2026-10-01" });
    await createNeed(db, ctx, f.project.id, { label: "Remote head", needFrom: "2026-11-10", needUntil: "2026-11-12", orderBy: "2026-11-05" });
    const events = await calendarEvents(db, f.ws.id, { from: "2026-10-20", to: "2026-11-30", today: "2026-10-20" });
    const due = events.filter((e) => e.kind === "due");
    expect(due.map((e) => [e.date, e.kind === "due" && e.units, e.kind === "due" && e.overdue])).toEqual([
      ["2026-10-01", 1, true],
      ["2026-11-02", 2, false],
    ]);
    expect(events.filter((e) => e.kind === "order").map((e) => e.date)).toEqual(["2026-11-05"]);
    expect(events.filter((e) => e.kind === "need").map((e) => e.kind === "need" && e.until)).toEqual(["2026-11-12"]);
  });
});

describe("daily summary", () => {
  it("is built in the person's language and sent once a day", async () => {
    const f = await makeFixture();
    await itemOnProject(f, { serialNumber: "D-1", returnDue: "2026-10-09" });
    await itemOnProject(f, { serialNumber: "D-2", returnDue: "2026-10-11" });
    await db.update(s.user).set({ locale: "de" }).where(eq(s.user.id, f.user.id));
    await saveReminderSettings(db, f.user.id, { ntfyTopic: "camera-test-topic", ntfyServer: "", reminderHour: 0, reminderDaysBefore: 1 });

    const digest = await buildDigest(db, f.user.id, "2026-10-10");
    expect(digest!.title).toBe("Camera Inventory: 1 überfällig, 1 Rückgabe");
    expect(digest!.message).toContain("Morgen: Rückgabe: 1 Teil an");

    const sent: { server: string; topic: string; title: string }[] = [];
    const send = async (server: string, topic: string, _t: string | null, m: { title: string }) => void sent.push({ server, topic, title: m.title });
    const now = new Date("2026-10-10T10:00:00Z");
    // Other people in the shared test database may also have topics: only look at this user.
    await runReminderTick(db, { now, send });
    await runReminderTick(db, { now, send });
    const mine = sent.filter((x) => x.topic === "camera-test-topic");
    expect(mine).toHaveLength(1);
    expect(mine[0]!.server).toBe("https://ntfy.sh");
  });

  it("tries again on the next tick when sending fails", async () => {
    const f = await makeFixture();
    await itemOnProject(f, { serialNumber: "E-1", returnDue: "2026-10-10" });
    await saveReminderSettings(db, f.user.id, { ntfyTopic: "camera-fail-topic", reminderHour: 0, reminderDaysBefore: 0 });
    const now = new Date("2026-10-10T10:00:00Z");
    let calls = 0;
    await runReminderTick(db, { now, send: async (_s, topic) => { if (topic === "camera-fail-topic") { calls++; throw new Error("offline"); } } });
    await runReminderTick(db, { now, send: async (_s, topic) => void (topic === "camera-fail-topic" && calls++) });
    expect(calls).toBe(2);
    await expect(saveReminderSettings(db, f.user.id, { ntfyTopic: "bad topic!", reminderHour: 8, reminderDaysBefore: 1 })).rejects.toThrow();
  });

  it("calendar links are secret tokens that can be renewed", async () => {
    const f = await makeFixture();
    const a = await rotateCalendarToken(db, f.user.id);
    expect((await userByCalendarToken(db, a))!.id).toBe(f.user.id);
    const b = await rotateCalendarToken(db, f.user.id);
    expect(await userByCalendarToken(db, a)).toBeNull();
    expect((await userByCalendarToken(db, b))!.id).toBe(f.user.id);
    expect(await userByCalendarToken(db, "short")).toBeNull();
  });
});
