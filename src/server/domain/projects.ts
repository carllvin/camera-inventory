import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import * as s from "../db/schema";
import { diff, recordEvent } from "./audit";
import { DomainError, notFound, pgErrorOf, requireRole, type Ctx } from "./context";
import { optionalDate, optionalText, requiredText } from "./validation";

export const PROJECT_STATUSES = s.projectStatus.enumValues;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const projectInput = z.object({
  name: requiredText(120),
  code: optionalText(20),
  status: z.enum(PROJECT_STATUSES).default("prep"),
  productionCompany: optionalText(120),
  description: optionalText(4000),
  startDate: optionalDate,
  endDate: optionalDate,
});
export type ProjectInput = z.input<typeof projectInput>;

export async function listProjects(db: DbOrTx, ctx: Ctx) {
  return db
    .select({
      id: s.project.id,
      name: s.project.name,
      code: s.project.code,
      status: s.project.status,
      productionCompany: s.project.productionCompany,
      startDate: s.project.startDate,
      endDate: s.project.endDate,
      itemCount: sql<number>`(SELECT count(*)::int FROM equipment_item i WHERE i.project_id = ${s.project.id})`,
      rentalHouseCount: sql<number>`(SELECT count(DISTINCT i.rental_house_id)::int FROM equipment_item i WHERE i.project_id = ${s.project.id})`,
      openIssueCount: sql<number>`(SELECT count(*)::int FROM issue x WHERE x.project_id = ${s.project.id} AND x.status IN ('open','in_progress'))`,
    })
    .from(s.project)
    .where(and(eq(s.project.workspaceId, ctx.workspaceId), isNull(s.project.archivedAt)))
    .orderBy(
      sql`CASE ${s.project.status} WHEN 'shooting' THEN 0 WHEN 'prep' THEN 1 WHEN 'wrap' THEN 2 WHEN 'planning' THEN 3 ELSE 4 END`,
      desc(s.project.startDate),
    );
}

export async function getProject(db: DbOrTx, ctx: Ctx, id: string) {
  const [p] = await db
    .select()
    .from(s.project)
    .where(and(eq(s.project.id, id), eq(s.project.workspaceId, ctx.workspaceId)));
  if (!p) notFound("Project");
  return p;
}

/** Header numbers for the project page. */
export async function getProjectSummary(db: DbOrTx, ctx: Ctx, id: string) {
  const project = await getProject(db, ctx, id);
  const [counts] = await db.execute<{
    items: number;
    units: number;
    in_use: number;
    missing: number;
    cases: number;
    open_issues: number;
    documents: number;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM equipment_item WHERE project_id = ${id}) AS items,
      (SELECT coalesce(sum(quantity),0)::int FROM equipment_item WHERE project_id = ${id}) AS units,
      (SELECT count(*)::int FROM equipment_item WHERE project_id = ${id} AND status = 'in_use') AS in_use,
      (SELECT count(*)::int FROM equipment_item WHERE project_id = ${id} AND status = 'missing') AS missing,
      (SELECT count(*)::int FROM equipment_case WHERE project_id = ${id} AND archived_at IS NULL) AS cases,
      (SELECT count(*)::int FROM issue WHERE project_id = ${id} AND status IN ('open','in_progress')) AS open_issues,
      (SELECT count(*)::int FROM document WHERE project_id = ${id}) AS documents
  `);
  // Every rental house linked to the project or owning equipment on it, with live counts.
  const rentalHouses = await db.execute<{
    id: string;
    name: string;
    short_name: string | null;
    order_reference: string | null;
    contact_name: string | null;
    on_project: number;
    returned: number;
  }>(sql`
    WITH rh_ids AS (
      SELECT rental_house_id AS id FROM project_rental_house WHERE project_id = ${id}
      UNION
      SELECT rental_house_id FROM equipment_item WHERE project_id = ${id} AND rental_house_id IS NOT NULL
      UNION
      SELECT rental_house_id FROM project_assignment WHERE project_id = ${id} AND rental_house_id IS NOT NULL
    )
    SELECT rh.id, rh.name, rh.short_name, prh.order_reference, prh.contact_name,
      (SELECT count(*)::int FROM equipment_item i WHERE i.project_id = ${id} AND i.rental_house_id = rh.id) AS on_project,
      (SELECT count(*)::int FROM project_assignment a WHERE a.project_id = ${id} AND a.rental_house_id = rh.id AND a.end_reason = 'returned') AS returned
    FROM rh_ids JOIN rental_house rh ON rh.id = rh_ids.id
    LEFT JOIN project_rental_house prh ON prh.project_id = ${id} AND prh.rental_house_id = rh.id
    WHERE rh.workspace_id = ${ctx.workspaceId}
    ORDER BY rh.name
  `);
  return { project, counts: counts!, rentalHouses: [...rentalHouses] };
}

function mapUnique(err: unknown, name: string): never {
  const pg = pgErrorOf(err);
  if (pg?.code === "23505" && pg.constraint_name === "project_workspace_name_uq") {
    throw new DomainError("CONFLICT", `A project named “${name}” already exists.`);
  }
  if (pg?.code === "23514" && pg.constraint_name === "project_dates_ck") {
    throw new DomainError("VALIDATION", "End date must be on or after the start date.");
  }
  throw err;
}

export async function createProject(db: DbOrTx, ctx: Ctx, input: ProjectInput) {
  requireRole(ctx, "member");
  const data = projectInput.parse(input);
  try {
    return await db.transaction(async (tx) => {
      const [p] = await tx
        .insert(s.project)
        .values({ workspaceId: ctx.workspaceId, ...data })
        .returning();
      await recordEvent(tx, ctx, {
        action: "project.created",
        entityType: "project",
        entityId: p!.id,
        projectId: p!.id,
        summary: `Project ${p!.name} created`,
      });
      return p!;
    });
  } catch (err) {
    mapUnique(err, data.name);
  }
}

export async function updateProject(db: DbOrTx, ctx: Ctx, id: string, input: ProjectInput) {
  requireRole(ctx, "member");
  const data = projectInput.parse(input);
  try {
    return await db.transaction(async (tx) => {
      const [prev] = await tx
        .select()
        .from(s.project)
        .where(and(eq(s.project.id, id), eq(s.project.workspaceId, ctx.workspaceId)))
        .for("update");
      if (!prev) notFound("Project");
      const changes = diff(prev, data);
      if (Object.keys(changes).length === 0) return prev;
      const [p] = await tx.update(s.project).set(data).where(eq(s.project.id, id)).returning();
      const statusChanged = "status" in changes;
      await recordEvent(tx, ctx, {
        action: statusChanged && Object.keys(changes).length === 1 ? "project.status_changed" : "project.updated",
        entityType: "project",
        entityId: id,
        projectId: id,
        summary: statusChanged
          ? `Project ${p!.name}: status ${prev.status} → ${p!.status}`
          : `Project ${p!.name} updated`,
        changes,
      });
      return p!;
    });
  } catch (err) {
    mapUnique(err, data.name);
  }
}

export const projectRentalHouseInput = z.object({
  rentalHouseId: z.uuid(),
  orderReference: optionalText(80),
  contactName: optionalText(120),
  contactPhone: optionalText(60),
  contactEmail: optionalText(200),
  notes: optionalText(2000),
});

/** Link a rental house to a project (or update the link's order/contact details). */
export async function linkRentalHouse(db: DbOrTx, ctx: Ctx, projectId: string, input: z.input<typeof projectRentalHouseInput>) {
  requireRole(ctx, "member");
  const data = projectRentalHouseInput.parse(input);
  return db.transaction(async (tx) => {
    await getProject(tx, ctx, projectId);
    const [rh] = await tx
      .select()
      .from(s.rentalHouse)
      .where(and(eq(s.rentalHouse.id, data.rentalHouseId), eq(s.rentalHouse.workspaceId, ctx.workspaceId)));
    if (!rh) notFound("Rental house");
    const [existing] = await tx
      .select()
      .from(s.projectRentalHouse)
      .where(and(eq(s.projectRentalHouse.projectId, projectId), eq(s.projectRentalHouse.rentalHouseId, rh.id)));
    const { rentalHouseId: _ignored, ...details } = data;
    if (existing) {
      await tx.update(s.projectRentalHouse).set(details).where(eq(s.projectRentalHouse.id, existing.id));
      return existing.id;
    }
    const [link] = await tx
      .insert(s.projectRentalHouse)
      .values({ workspaceId: ctx.workspaceId, projectId, ...data })
      .returning();
    await recordEvent(tx, ctx, {
      action: "rental_house.linked_to_project",
      entityType: "rental_house",
      entityId: rh.id,
      rentalHouseId: rh.id,
      projectId,
      summary: `${rh.name} linked to project${data.orderReference ? ` (order ${data.orderReference})` : ""}`,
    });
    return link!.id;
  });
}

export async function listProjectOptions(db: DbOrTx, ctx: Ctx, opts: { activeOnly?: boolean } = {}) {
  const rows = await db
    .select({ id: s.project.id, name: s.project.name, status: s.project.status })
    .from(s.project)
    .where(and(eq(s.project.workspaceId, ctx.workspaceId), isNull(s.project.archivedAt)))
    .orderBy(asc(s.project.name));
  return opts.activeOnly ? rows.filter((r) => r.status !== "closed") : rows;
}
