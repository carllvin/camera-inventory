import { describe, expect, it } from "vitest";
import { activityTone, groupActivity } from "../src/lib/activity-groups";

const ev = (id: number, action: string, correlationId: string | null, day = "2026-10-07") => ({ id, action, correlationId, occurredAt: `${day}T10:00:00Z` });

describe("history grouping", () => {
  it("collapses one operation into one entry headed by its summary, bucketed by day", () => {
    const days = groupActivity(
      [
        ev(9, "equipment_item.status_changed", null),
        ev(8, "equipment_item.assigned_to_project", "c1"),
        ev(7, "delivery.imported", "c1"),
        ev(6, "equipment_item.created", "c1"),
        ev(5, "equipment_item.added_to_case", "c2", "2026-10-06"),
      ],
      (d) => String(d).slice(0, 10),
    );
    expect(days.map((d) => d.day)).toEqual(["2026-10-07", "2026-10-06"]);
    expect(days[0]!.groups.map((g) => [g.head.id, g.rest.map((r) => r.id)])).toEqual([[9, []], [7, [8, 6]]]);
  });

  it("colours by meaning", () => {
    expect(activityTone({ action: "equipment_item.status_changed", changes: { status: { from: "in_use", to: "missing" } } })).toBe("danger");
    expect(activityTone({ action: "equipment_item.condition_changed", changes: { condition: { from: "ok", to: "damaged" } } })).toBe("warn");
    expect(activityTone({ action: "delivery.imported" })).toBe("ok");
    expect(activityTone({ action: "equipment_item.returned" })).toBe("info");
    expect(activityTone({ action: "equipment_item.added_to_case" })).toBe("set");
    expect(activityTone({ action: "equipment_item.updated" })).toBe("neutral");
  });
});
