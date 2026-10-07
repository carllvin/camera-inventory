/** Soft removal from a project (no review) and the optional return-note double check. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/server/db/schema";
import { ManualExtractor } from "../src/server/ai";
import { createCase, packItem } from "../src/server/domain/cases";
import type { Ctx } from "../src/server/domain/context";
import { addLine, confirmReturn, createDocumentFromUpload, getDocumentReview } from "../src/server/domain/documents";
import { createItem } from "../src/server/domain/equipment-items";
import { removeEquipment } from "../src/server/domain/project-removal";
import { createProject } from "../src/server/domain/projects";
import { createRentalHouse } from "../src/server/domain/rental-houses";
import { LocalStorage } from "../src/server/storage";
import { client, db, makeFixture, type Fixture } from "./helpers/db";

let dir: string;
let storage: LocalStorage;
let f: Fixture;
let ctx: Ctx;
let rh: { id: string };

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ci-rm-"));
  storage = new LocalStorage(dir);
  f = await makeFixture();
  ctx = { workspaceId: f.ws.id, userId: f.user.id, role: "owner" };
  rh = await createRentalHouse(db, ctx, { name: "Rental R" });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await client.end();
});

async function scenario(name: string) {
  const p = await createProject(db, ctx, { name, status: "shooting" });
  const cams = [];
  for (const n of [1, 2, 3]) cams.push(await createItem(db, ctx, { equipmentTypeId: f.camType.id, serialNumber: `${name}-${n}`, rentalHouseId: rh.id, projectId: p.id }));
  const cables = await createItem(db, ctx, { equipmentTypeId: f.cableType.id, quantity: 10, rentalHouseId: rh.id, projectId: p.id });
  const owned = await createItem(db, ctx, { equipmentTypeId: f.cableType.id, quantity: 2, projectId: p.id });
  const c = await createCase(db, ctx, { projectId: p.id, name: "A-Cam" });
  await packItem(db, ctx, c.id, cams[0]!.id);
  return { p, cams, cables, owned, caseId: c.id };
}

const get = async (id: string) => (await db.select().from(s.equipmentItem).where(eq(s.equipmentItem.id, id)))[0]!;

describe("soft removal", () => {
  it("removes a whole case, single items and some units; history stays", async () => {
    const { p, cams, cables, owned, caseId } = await scenario("Soft");
    const r = await removeEquipment(db, ctx, { projectId: p.id, reason: "returned", note: "driver" }, {
      caseIds: [caseId],
      items: [{ id: owned.id }],
      groups: [{ itemIds: [cables.id], units: 4 }],
    });
    expect(r).toMatchObject({ cases: 1, units: 1 + 2 + 4 });
    expect(await get(cams[0]!.id)).toMatchObject({ status: "returned", projectId: null, caseId: null });
    expect(await get(owned.id)).toMatchObject({ status: "available", projectId: null }); // owned: not "returned"
    expect(await get(cables.id)).toMatchObject({ quantity: 6, projectId: p.id }); // the rest stays
    expect(await get(cams[1]!.id)).toMatchObject({ projectId: p.id });
    const [c] = await db.select().from(s.equipmentCase).where(eq(s.equipmentCase.id, caseId));
    expect(c!.archivedAt).not.toBeNull();
    const ended = await db.select().from(s.projectAssignment).where(and(eq(s.projectAssignment.equipmentItemId, cams[0]!.id)));
    expect(ended[0]).toMatchObject({ endReason: "returned" });
    const events = await db.select().from(s.auditEvent).where(eq(s.auditEvent.correlationId, r.correlationId));
    expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(["equipment_item.returned", "equipment_item.removed_from_project", "equipment_item.split", "case.archived"]));

    // "Not on this project": rented items become available, not returned.
    await removeEquipment(db, ctx, { projectId: p.id, reason: "removed" }, { items: [{ id: cams[1]!.id }] });
    expect(await get(cams[1]!.id)).toMatchObject({ status: "available" });
    await expect(removeEquipment(db, ctx, { projectId: p.id }, { items: [{ id: cams[1]!.id }] })).rejects.toThrow(/no longer on/);
    await expect(removeEquipment(db, ctx, { projectId: p.id }, {})).rejects.toThrow(/Choose/);
  });

  it("a return note attached to a removal double-checks it", async () => {
    const { p, cams, cables } = await scenario("Check");
    const note = await createDocumentFromUpload(db, storage, ctx, new ManualExtractor(), { kind: "return_note", projectId: p.id }, [
      { name: "note.jpg", type: "image/jpeg", bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) },
    ]);
    const id = note.document.id;
    await removeEquipment(db, ctx, { projectId: p.id, returnDocumentId: id }, { items: [{ id: cams[0]!.id }, { id: cams[1]!.id }], groups: [{ itemIds: [cables.id], units: 5 }] });

    const [doc] = await db.select().from(s.document).where(eq(s.document.id, id));
    expect(doc!.rentalHouseId).toBe(rh.id); // filled in from the removed equipment

    // The note lists cam 1, cam 3 (still on the project) and 5 cables - not cam 2.
    await addLine(db, ctx, id, { description: "ALEXA 35", quantity: 1, serialNumber: cams[0]!.serialNumber });
    await addLine(db, ctx, id, { description: "ALEXA 35", quantity: 1, serialNumber: cams[2]!.serialNumber });
    await addLine(db, ctx, id, { description: "BNC", quantity: 5, equipmentTypeId: f.cableType.id });
    const review = await getDocumentReview(db, ctx, id);
    expect(review.lines.map((l) => l.resolution)).toEqual(["match_existing", "match_existing", "match_existing"]);
    expect(review.lines[0]!.matchReason).toMatch(/already removed/);
    expect(review.lines[2]!.matchReason).toMatch(/already removed/); // the removed 5, not the 5 still on the project
    const removed = review.returnOverview!.removed;
    expect(removed.find((r) => r.id === cams[1]!.id)).toMatchObject({ onNote: 0 });
    expect(removed.find((r) => r.id === cams[0]!.id)).toMatchObject({ onNote: 1 });
    expect(review.returnOverview!.returning).toBe(1); // cam 3 still goes back with the note

    const r = await confirmReturn(db, ctx, id);
    expect(r).toMatchObject({ returned: 1, checked: 6 });
    expect(await get(cams[2]!.id)).toMatchObject({ status: "returned", projectId: null });
    expect(await get(cables.id)).toMatchObject({ quantity: 5, projectId: p.id });
    const open = await db.select().from(s.projectAssignment).where(and(eq(s.projectAssignment.projectId, p.id), isNull(s.projectAssignment.endedAt)));
    expect(open).toHaveLength(2); // the 5 remaining rented cables + the owned ones
  });
});
