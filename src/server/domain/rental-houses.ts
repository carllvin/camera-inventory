import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import { diff, recordEvent } from "./audit";
import { DomainError, notFound, pgErrorOf, requireRole, type Ctx } from "./context";
import { optionalText, requiredText, stringList } from "./validation";

export const rentalHouseInput = z.object({
  name: requiredText(120),
  shortName: optionalText(40),
  aliases: stringList,
  website: optionalText(300),
  email: optionalText(200),
  phone: optionalText(60),
  address: optionalText(500),
  notes: optionalText(4000),
});
export type RentalHouseInput = z.input<typeof rentalHouseInput>;

export async function listRentalHouses(db: DbOrTx, ctx: Ctx) {
  return db
    .select({
      id: s.rentalHouse.id,
      name: s.rentalHouse.name,
      shortName: s.rentalHouse.shortName,
      aliases: s.rentalHouse.aliases,
      phone: s.rentalHouse.phone,
      email: s.rentalHouse.email,
      onProjects: sql<number>`(SELECT count(*)::int FROM equipment_item i WHERE i.rental_house_id = "rental_house"."id" AND i.project_id IS NOT NULL)`,
      projectCount: sql<number>`(SELECT count(DISTINCT i.project_id)::int FROM equipment_item i WHERE i.rental_house_id = "rental_house"."id" AND i.project_id IS NOT NULL)`,
    })
    .from(s.rentalHouse)
    .where(and(eq(s.rentalHouse.workspaceId, ctx.workspaceId), isNull(s.rentalHouse.archivedAt)))
    .orderBy(asc(s.rentalHouse.name));
}

export async function getRentalHouse(db: DbOrTx, ctx: Ctx, id: string) {
  const [rh] = await db
    .select()
    .from(s.rentalHouse)
    .where(and(eq(s.rentalHouse.id, id), eq(s.rentalHouse.workspaceId, ctx.workspaceId)));
  if (!rh) notFound("Rental house");
  return rh;
}

/** Equipment from this rental house currently out on projects, grouped by project. */
export async function getRentalHouseProjects(db: DbOrTx, ctx: Ctx, id: string) {
  const rows = await db.execute<{ project_id: string; project_name: string; status: string; on_project: number }>(sql`
    SELECT p.id AS project_id, p.name AS project_name, p.status::text AS status, count(i.id)::int AS on_project
    FROM equipment_item i JOIN project p ON p.id = i.project_id
    WHERE i.workspace_id = ${ctx.workspaceId} AND i.rental_house_id = ${id}
    GROUP BY p.id ORDER BY p.name`);
  return [...rows];
}

function mapErr(err: unknown, name: string): never {
  const pg = pgErrorOf(err);
  if (pg?.code === "23505") throw new DomainError("CONFLICT", `A rental house named “${name}” already exists.`);
  throw err;
}

export async function createRentalHouse(db: DbOrTx, ctx: Ctx, input: RentalHouseInput) {
  requireRole(ctx, "member");
  const data = rentalHouseInput.parse(input);
  try {
    return await db.transaction(async (tx) => {
      const [rh] = await tx.insert(s.rentalHouse).values({ workspaceId: ctx.workspaceId, ...data }).returning();
      await recordEvent(tx, ctx, {
        action: "rental_house.created",
        entityType: "rental_house",
        entityId: rh!.id,
        rentalHouseId: rh!.id,
        summary: `Rental house ${rh!.name} created`,
      });
      return rh!;
    });
  } catch (err) {
    mapErr(err, data.name);
  }
}

export async function updateRentalHouse(db: DbOrTx, ctx: Ctx, id: string, input: RentalHouseInput) {
  requireRole(ctx, "member");
  const data = rentalHouseInput.parse(input);
  try {
    return await db.transaction(async (tx) => {
      const prev = await getRentalHouse(tx, ctx, id);
      const changes = diff(prev, data);
      if (Object.keys(changes).length === 0) return prev;
      const [rh] = await tx.update(s.rentalHouse).set(data).where(eq(s.rentalHouse.id, id)).returning();
      await recordEvent(tx, ctx, {
        action: "rental_house.updated",
        entityType: "rental_house",
        entityId: id,
        rentalHouseId: id,
        summary: `Rental house ${rh!.name} updated`,
        changes,
      });
      return rh!;
    });
  } catch (err) {
    mapErr(err, data.name);
  }
}
