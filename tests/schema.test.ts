/**
 * Phase 2 schema verification: the mandatory data-integrity rules are enforced by
 * the database itself, not only by application code.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/server/db/schema";
import { PG, client, db, expectDbError, itemOnProject, makeFixture, type Fixture } from "./helpers/db";

let f: Fixture;

beforeAll(async () => {
  f = await makeFixture();
});

afterAll(async () => {
  await client.end();
});

async function makeCase(projectId: string, name: string) {
  const [c] = await db.insert(s.equipmentCase).values({ workspaceId: f.ws.id, projectId, name }).returning();
  return c!;
}

describe("equipment item: project and case membership", () => {
  it("an item can only be in a case that belongs to its own project", async () => {
    const item = await itemOnProject(f, { serialNumber: "CASE-1" });
    const caseOnOtherProject = await makeCase(f.project2.id, "Other project case");
    await expectDbError(
      db.update(s.equipmentItem).set({ caseId: caseOnOtherProject.id }).where(eq(s.equipmentItem.id, item.id)),
      PG.foreignKeyViolation,
      "equipment_item_case_fk",
    );
    const ownCase = await makeCase(f.project.id, "A-Cam");
    await db.update(s.equipmentItem).set({ caseId: ownCase.id }).where(eq(s.equipmentItem.id, item.id));
    const [row] = await db.select().from(s.equipmentItem).where(eq(s.equipmentItem.id, item.id));
    expect(row!.caseId).toBe(ownCase.id);
  });

  it("an item in a case must be on a project", async () => {
    const c = await makeCase(f.project.id, "Orphan check");
    await expectDbError(
      db.insert(s.equipmentItem).values({ workspaceId: f.ws.id, equipmentTypeId: f.camType.id, caseId: c.id, status: "available" }),
      PG.checkViolation,
      "equipment_item_case_needs_project_ck",
    );
  });

  it("returned items cannot still be on a project", async () => {
    const item = await itemOnProject(f, { serialNumber: "RET-1" });
    await expectDbError(
      db.update(s.equipmentItem).set({ status: "returned" }).where(eq(s.equipmentItem.id, item.id)),
      PG.checkViolation,
      "equipment_item_status_location_ck",
    );
  });

  it("on-project statuses require a project", async () => {
    await expectDbError(
      db.insert(s.equipmentItem).values({ workspaceId: f.ws.id, equipmentTypeId: f.camType.id, status: "in_use" }),
      PG.checkViolation,
      "equipment_item_status_location_ck",
    );
  });

  it("returning an item keeps the row and closes the assignment (history preserved)", async () => {
    const item = await itemOnProject(f, { serialNumber: "RET-2" });
    await db.transaction(async (tx) => {
      await tx.update(s.equipmentItem).set({ projectId: null, caseId: null, status: "returned" }).where(eq(s.equipmentItem.id, item.id));
      await tx
        .update(s.projectAssignment)
        .set({ endedAt: new Date(), endReason: "returned" })
        .where(and(eq(s.projectAssignment.equipmentItemId, item.id), isNull(s.projectAssignment.endedAt)));
    });
    const [row] = await db.select().from(s.equipmentItem).where(eq(s.equipmentItem.id, item.id));
    expect(row).toMatchObject({ status: "returned", projectId: null });
    const assignments = await db.select().from(s.projectAssignment).where(eq(s.projectAssignment.equipmentItemId, item.id));
    expect(assignments).toHaveLength(1);
    expect(assignments[0]!.endReason).toBe("returned");

    // ...and the same physical item can be delivered to another project later.
    await db.transaction(async (tx) => {
      await tx.update(s.equipmentItem).set({ projectId: f.project2.id, status: "on_project" }).where(eq(s.equipmentItem.id, item.id));
      await tx.insert(s.projectAssignment).values({ workspaceId: f.ws.id, equipmentItemId: item.id, projectId: f.project2.id });
    });
    const history = await db.select().from(s.projectAssignment).where(eq(s.projectAssignment.equipmentItemId, item.id));
    expect(history.map((h) => h.projectId).sort()).toEqual([f.project.id, f.project2.id].sort());
  });

  it("an item cannot have two open project assignments", async () => {
    const item = await itemOnProject(f, { serialNumber: "DUP-ASSIGN" });
    await expectDbError(
      db.insert(s.projectAssignment).values({ workspaceId: f.ws.id, equipmentItemId: item.id, projectId: f.project2.id }),
      PG.uniqueViolation,
      "project_assignment_one_open_uq",
    );
  });

  it("item.project_id must match its open assignment (checked at commit)", async () => {
    await expectDbError(
      db.transaction(async (tx) => {
        await tx.insert(s.equipmentItem).values({
          workspaceId: f.ws.id,
          equipmentTypeId: f.camType.id,
          projectId: f.project.id,
          status: "on_project",
          serialNumber: "NO-ASSIGN",
        });
      }),
      PG.integrityViolation,
      "open assignment",
    );
    const item = await itemOnProject(f, { serialNumber: "MOVE-1" });
    // Moving to another project without closing/opening assignments is rejected.
    await expectDbError(
      db.update(s.equipmentItem).set({ projectId: f.project2.id }).where(eq(s.equipmentItem.id, item.id)),
      PG.integrityViolation,
    );
  });

  it("project assignments cannot be deleted", async () => {
    const item = await itemOnProject(f, { serialNumber: "NODEL" });
    await expectDbError(
      db.delete(s.projectAssignment).where(eq(s.projectAssignment.equipmentItemId, item.id)),
      PG.insufficientPrivilege,
    );
  });
});

describe("equipment item identity", () => {
  it("never silently merges: serials are unique per type (case-insensitive)", async () => {
    await itemOnProject(f, { serialNumber: "35-10421" });
    await expectDbError(itemOnProject(f, { serialNumber: "35-10421" }), PG.uniqueViolation, "equipment_item_serial_uq");
    await itemOnProject(f, { serialNumber: "MVF-A1" });
    await expectDbError(itemOnProject(f, { serialNumber: "mvf-a1" }), PG.uniqueViolation, "equipment_item_serial_uq");
    // Same serial on a different product type is a different physical object.
    await itemOnProject(f, { serialNumber: "35-10421", equipmentTypeId: f.cableType.id });
  });

  it("serialized items have quantity 1; bulk items can have more", async () => {
    await expectDbError(itemOnProject(f, { quantity: 3 }), PG.checkViolation, "equipment_item_serialized_qty_ck");
    const bulk = await itemOnProject(f, { equipmentTypeId: f.cableType.id, trackingMode: "bulk", quantity: 12 });
    expect(bulk.quantity).toBe(12);
  });

  it("blank serial numbers are rejected", async () => {
    await expectDbError(itemOnProject(f, { serialNumber: "   " }), PG.checkViolation, "equipment_item_serial_not_blank_ck");
  });
});

describe("workspace isolation", () => {
  it("rows cannot reference another workspace's entities", async () => {
    const other = await makeFixture();
    // Item in workspace A pointing to a project in workspace B.
    await expectDbError(
      db.insert(s.equipmentItem).values({
        workspaceId: f.ws.id,
        equipmentTypeId: f.camType.id,
        projectId: other.project.id,
        status: "on_project",
      }),
      PG.foreignKeyViolation,
      "equipment_item_project_fk",
    );
    // Item in workspace A using an equipment type from workspace B.
    await expectDbError(
      db.insert(s.equipmentItem).values({ workspaceId: f.ws.id, equipmentTypeId: other.camType.id }),
      PG.foreignKeyViolation,
      "equipment_item_type_fk",
    );
    // Case in workspace A on a project from workspace B.
    await expectDbError(
      db.insert(s.equipmentCase).values({ workspaceId: f.ws.id, projectId: other.project.id, name: "x" }),
      PG.foreignKeyViolation,
      "equipment_case_project_fk",
    );
  });
});

describe("audit log", () => {
  it("is append-only", async () => {
    const [ev] = await db
      .insert(s.auditEvent)
      .values({
        workspaceId: f.ws.id,
        actorUserId: f.user.id,
        action: "project.created",
        entityType: "project",
        entityId: f.project.id,
        projectId: f.project.id,
        summary: "Project created",
      })
      .returning();
    await expectDbError(db.update(s.auditEvent).set({ summary: "tampered" }).where(eq(s.auditEvent.id, ev!.id)), PG.insufficientPrivilege);
    await expectDbError(db.delete(s.auditEvent).where(eq(s.auditEvent.id, ev!.id)), PG.insufficientPrivilege);
    await expectDbError(db.execute(sql`TRUNCATE audit_event`), PG.insufficientPrivilege);
  });

  it("user actions must name the user", async () => {
    await expectDbError(
      db.insert(s.auditEvent).values({ workspaceId: f.ws.id, action: "project.updated", entityType: "project", entityId: f.project.id, summary: "x" }),
      PG.checkViolation,
      "audit_event_actor_ck",
    );
    // System / AI events need no user.
    await db.insert(s.auditEvent).values({
      workspaceId: f.ws.id,
      actorType: "ai",
      action: "document.extracted",
      entityType: "project",
      entityId: f.project.id,
      summary: "x",
    });
  });
});

describe("categories", () => {
  it("cannot form cycles", async () => {
    const [a] = await db.insert(s.category).values({ workspaceId: f.ws.id, name: "Lenses" }).returning();
    const [b] = await db.insert(s.category).values({ workspaceId: f.ws.id, name: "Spherical", parentId: a!.id }).returning();
    const [c] = await db.insert(s.category).values({ workspaceId: f.ws.id, name: "Primes", parentId: b!.id }).returning();
    await expectDbError(db.update(s.category).set({ parentId: c!.id }).where(eq(s.category.id, a!.id)), PG.checkViolation, "descendant");
    await expectDbError(db.update(s.category).set({ parentId: a!.id }).where(eq(s.category.id, a!.id)), PG.checkViolation);
  });

  it("sibling names are unique, including at the root", async () => {
    await expectDbError(db.insert(s.category).values({ workspaceId: f.ws.id, name: "camera" }), PG.uniqueViolation, "category_sibling_name_uq");
  });
});

describe("search text", () => {
  it("is maintained by trigger and supports aliases, accents and compact serials", async () => {
    const [t] = await db
      .insert(s.equipmentType)
      .values({ workspaceId: f.ws.id, manufacturer: "Angénieux", model: "Optimo 24-290", name: "Angénieux Optimo 24-290", aliases: ["Optimo 12x"] })
      .returning();
    expect(t!.searchText).toContain("angenieux");
    expect(t!.searchText).toContain("optimo 12x");
    const hits = await db.execute<{ id: string }>(
      sql`SELECT id FROM equipment_type WHERE workspace_id = ${f.ws.id} AND search_text % search_normalize(${"Angenieux Optimo"})`,
    );
    expect(hits.map((h) => h.id)).toContain(t!.id);

    const item = await itemOnProject(f, { serialNumber: "SN-77 812", assetNumber: "AR-0042" });
    const bySerial = await db.execute<{ id: string }>(
      sql`SELECT id FROM equipment_item WHERE search_text LIKE '%' || search_compact(${"sn77812"}) || '%'`,
    );
    expect(bySerial.map((r) => r.id)).toContain(item.id);
  });
});

describe("issues and documents", () => {
  it("resolved issues need a resolution timestamp", async () => {
    await expectDbError(
      db.insert(s.issue).values({ workspaceId: f.ws.id, type: "missing", title: "x", status: "resolved" }),
      PG.checkViolation,
      "issue_resolution_ck",
    );
  });

  it("a confirmed document must be linked to a project", async () => {
    await expectDbError(
      db.insert(s.document).values({ workspaceId: f.ws.id, kind: "delivery_note", status: "confirmed", confirmedAt: new Date() }),
      PG.checkViolation,
      "document_confirmed_ck",
    );
  });

  it("reference photos belong to an equipment type, only one primary", async () => {
    const base = { workspaceId: f.ws.id, kind: "reference" as const, storageKey: "k", mimeType: "image/jpeg" };
    await expectDbError(db.insert(s.photo).values({ ...base, projectId: f.project.id }), PG.checkViolation, "photo_reference_needs_type_ck");
    await db.insert(s.photo).values({ ...base, equipmentTypeId: f.camType.id, isPrimary: true });
    await expectDbError(
      db.insert(s.photo).values({ ...base, equipmentTypeId: f.camType.id, isPrimary: true }),
      PG.uniqueViolation,
      "photo_primary_reference_uq",
    );
  });
});
