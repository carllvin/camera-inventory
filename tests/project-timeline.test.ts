import { describe, expect, it } from "vitest";
import { projectTimeline } from "../src/lib/project-timeline";

describe("projectTimeline", () => {
  it("describes before, during and after the rental period", () => {
    expect(projectTimeline("2026-10-10", "2026-10-20", "2026-10-07")).toEqual({ text: "Starts in 3 days", tone: "neutral" });
    expect(projectTimeline("2026-10-08", "2026-10-20", "2026-10-07")?.text).toBe("Starts tomorrow");
    expect(projectTimeline("2026-10-01", "2026-10-20", "2026-10-07")).toEqual({ text: "Day 7 of 20 · 13 days left", tone: "neutral" });
    expect(projectTimeline("2026-10-01", "2026-10-09", "2026-10-07")).toEqual({ text: "Day 7 of 9 · 2 days left", tone: "warn" });
    expect(projectTimeline("2026-10-01", "2026-10-08", "2026-10-07")?.text).toBe("Day 7 of 8 · ends tomorrow");
    expect(projectTimeline("2026-10-01", "2026-10-07", "2026-10-07")).toEqual({ text: "Ends today", tone: "warn" });
    expect(projectTimeline("2026-10-01", "2026-10-05", "2026-10-07")).toEqual({ text: "Ended 2 days ago — equipment still out?", tone: "danger" });
    expect(projectTimeline(null, "2026-10-17", "2026-10-07")?.text).toBe("10 days left");
    expect(projectTimeline("2026-10-01", null, "2026-10-07")?.text).toBe("Day 7");
    expect(projectTimeline(null, null, "2026-10-07")).toBeNull();
  });
});
