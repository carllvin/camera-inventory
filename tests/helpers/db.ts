import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { createDb } from "../../src/server/db/client";
import * as s from "../../src/server/db/schema";

export const { db, client } = createDb(process.env.TEST_DATABASE_URL!, { max: 4 });

interface PgError {
  code?: string;
  constraint_name?: string;
  message?: string;
}

/** Drizzle wraps driver errors; find the underlying Postgres error. */
function pgError(err: unknown): PgError {
  let e = err as { cause?: unknown } & PgError;
  while (e && !e.code && e.cause) e = e.cause as typeof e;
  return e;
}

/** Assert that a DB operation fails with a given SQLSTATE and (optionally) constraint name or message fragment. */
export async function expectDbError(p: Promise<unknown>, code: string, constraintOrMessage?: string) {
  let caught: unknown;
  try {
    await p;
  } catch (err) {
    caught = err;
  }
  expect(caught, "expected the database to reject the operation").toBeDefined();
  const e = pgError(caught);
  expect(e.code).toBe(code);
  if (constraintOrMessage) {
    expect([e.constraint_name, e.message].join(" ")).toContain(constraintOrMessage);
  }
}

export const PG = {
  uniqueViolation: "23505",
  foreignKeyViolation: "23503",
  checkViolation: "23514",
  integrityViolation: "23000",
  insufficientPrivilege: "42501",
} as const;

/** Minimal isolated workspace: user, project, rental house, category, two equipment types. */
export async function makeFixture() {
  const tag = randomUUID().slice(0, 8);
  const [w] = await db.insert(s.workspace).values({ name: `WS ${tag}`, slug: `ws-${tag}` }).returning();
  const [u] = await db.insert(s.user).values({ name: `User ${tag}`, email: `${tag}@test.example` }).returning();
  await db.insert(s.workspaceMember).values({ workspaceId: w!.id, userId: u!.id, role: "owner" });
  const [p] = await db.insert(s.project).values({ workspaceId: w!.id, name: "Project A" }).returning();
  const [p2] = await db.insert(s.project).values({ workspaceId: w!.id, name: "Project B" }).returning();
  const [rh] = await db.insert(s.rentalHouse).values({ workspaceId: w!.id, name: "Rental Co" }).returning();
  const [cat] = await db.insert(s.category).values({ workspaceId: w!.id, name: "Camera" }).returning();
  const [cam] = await db
    .insert(s.equipmentType)
    .values({ workspaceId: w!.id, categoryId: cat!.id, manufacturer: "ARRI", model: "ALEXA 35", name: "ARRI ALEXA 35", aliases: ["A35"] })
    .returning();
  const [cable] = await db
    .insert(s.equipmentType)
    .values({ workspaceId: w!.id, manufacturer: "Generic", model: "BNC 1m", name: "BNC 1m", defaultTrackingMode: "bulk" })
    .returning();
  return { ws: w!, user: u!, project: p!, project2: p2!, rentalHouse: rh!, category: cat!, camType: cam!, cableType: cable! };
}

export type Fixture = Awaited<ReturnType<typeof makeFixture>>;

/** Put a new item on a project the way a service does: item + open assignment in one transaction. */
export async function itemOnProject(f: Fixture, values: Partial<typeof s.equipmentItem.$inferInsert> = {}) {
  return db.transaction(async (tx) => {
    const [item] = await tx
      .insert(s.equipmentItem)
      .values({
        workspaceId: f.ws.id,
        equipmentTypeId: f.camType.id,
        rentalHouseId: f.rentalHouse.id,
        projectId: f.project.id,
        status: "on_project",
        ...values,
      })
      .returning();
    await tx.insert(s.projectAssignment).values({
      workspaceId: f.ws.id,
      equipmentItemId: item!.id,
      projectId: item!.projectId!,
      rentalHouseId: f.rentalHouse.id,
      quantity: item!.quantity,
    });
    return item!;
  });
}
