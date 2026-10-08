import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as s from "../src/server/db/schema";
import { seedDemo } from "../src/server/db/seed/demo";
import { client, db } from "./helpers/db";

afterAll(async () => {
  await client.end();
});

describe("demo seed", () => {
  it("produces a consistent, realistic dataset", async () => {
    const r = await seedDemo(db);
    const ffx = r.projectIds.feature!;

    const caseCounts = await db.execute<{ name: string; actual: number; expected: number }>(sql`
      SELECT c.name,
        (SELECT coalesce(sum(quantity), 0)::int FROM equipment_item WHERE case_id = c.id) AS actual,
        (SELECT coalesce(sum(quantity), 0)::int FROM case_expected_item WHERE case_id = c.id) AS expected
      FROM equipment_case c WHERE c.project_id = ${ffx} ORDER BY c.name`);
    expect(caseCounts.find((c) => c.name === "A-Cam Set")).toMatchObject({ actual: 7, expected: 8 });

    // Project holds equipment from three rental houses.
    const houses = await db
      .selectDistinct({ id: s.equipmentItem.rentalHouseId })
      .from(s.equipmentItem)
      .where(eq(s.equipmentItem.projectId, ffx));
    expect(houses).toHaveLength(3);

    // The ALEXA 35 from the wrapped commercial was reused: two assignments, one open.
    const [alexa] = await db.select().from(s.equipmentItem).where(and(eq(s.equipmentItem.workspaceId, r.workspaceId), eq(s.equipmentItem.serialNumber, "35-10421")));
    const stints = await db.select().from(s.projectAssignment).where(eq(s.projectAssignment.equipmentItemId, alexa!.id));
    expect(stints).toHaveLength(2);
    expect(stints.filter((a) => a.endedAt === null)).toHaveLength(1);

    // Partial return: MBF equipment still on project after the return note.
    const mbfOnProject = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM equipment_item i JOIN rental_house rh ON rh.id = i.rental_house_id
      WHERE rh.short_name = 'MBF' AND i.project_id = ${ffx}`);
    expect(mbfOnProject[0]!.n).toBeGreaterThan(0);

    // Every item has at least one history event.
    const withoutHistory = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM equipment_item i
      WHERE i.workspace_id = ${r.workspaceId}
        AND NOT EXISTS (SELECT 1 FROM audit_event e WHERE e.equipment_item_id = i.id)
        AND i.split_from_item_id IS NULL`);
    expect(withoutHistory[0]!.n).toBe(0);
  });
});

describe("read models on demo data", () => {
  it("project list counts pieces and rental houses per project", async () => {
    const { listProjects } = await import("../src/server/domain/projects");
    const { listEquipmentTypes } = await import("../src/server/domain/equipment-types");
    const { listRentalHouses } = await import("../src/server/domain/rental-houses");
    const [w] = await db.select().from(s.workspace).where(eq(s.workspace.slug, "nordlicht"));
    const [m] = await db.select().from(s.workspaceMember).where(eq(s.workspaceMember.workspaceId, w!.id));
    const ctx = { workspaceId: w!.id, userId: m!.userId, role: "owner" as const };
    const ffx = (await listProjects(db, ctx)).find((p) => p.code === "FFX")!;
    expect(ffx.itemCount).toBe(46);
    expect(ffx.rentalHouseCount).toBe(3);
    expect(ffx.openIssueCount).toBe(2);
    const alexa = (await listEquipmentTypes(db, ctx)).find((t) => t.model === "ALEXA 35")!;
    expect(alexa.itemCount).toBe(2);
    const arri = (await listRentalHouses(db, ctx)).find((r) => r.shortName === "ARRI")!;
    expect(arri.onProjects).toBe(22);
  });
});
