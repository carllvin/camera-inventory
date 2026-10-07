/** Matching printed lines to equipment types: the maker and model written on the note decide. */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/server/db/schema";
import type { Ctx } from "../src/server/domain/context";
import { findType } from "../src/server/domain/document-matching";
import { createEquipmentType } from "../src/server/domain/equipment-types";
import { importStandardCatalog } from "../src/server/domain/standard-catalog";
import { client, db, makeFixture, type Fixture } from "./helpers/db";

let f: Fixture;
let ctx: Ctx;

beforeAll(async () => {
  f = await makeFixture();
  ctx = { workspaceId: f.ws.id, userId: f.user.id, role: "owner" };
  // As in a workspace imported from an older catalog: no rental-house spellings on bebob / IDX yet.
  await createEquipmentType(db, ctx, { manufacturer: "bebob", model: "V98micro", aliases: "Bebob V98" });
  await createEquipmentType(db, ctx, { manufacturer: "SWIT", model: "PB-M98S", aliases: "SWIT V-Mount Akku 98Wh Pocket PB-M98S" });
  await createEquipmentType(db, ctx, { manufacturer: "IDX", model: "VL-4S", aliases: "VL-4SE" });
  await createEquipmentType(db, ctx, { manufacturer: "SWIT", model: "PC-P430S", aliases: "SWIT V-Mount Charger 4-fach PC-P430S" });
  await createEquipmentType(db, ctx, { manufacturer: "Canon", model: "C70" });
});

afterAll(async () => {
  await client.end();
});

const line = (description: string) => ({ description, manufacturer: null, model: null, catalogMatch: null });

describe("findType", () => {
  it("follows the maker and model on the line, not the closest-sounding name", async () => {
    expect((await findType(db, ctx.workspaceId, line("BEBOB V-Mount Akku 98Wh V98micro")))?.name).toBe("bebob V98micro");
    expect((await findType(db, ctx.workspaceId, line("IDX V-Mount Charger 4-fach + NK VL-4S")))?.name).toBe("IDX VL-4S");
    expect((await findType(db, ctx.workspaceId, line("SWIT V-Mount Akku 98Wh Pocket PB-M98S")))?.name).toBe("SWIT PB-M98S");
  });

  it("does not take a short model inside a longer one", async () => {
    expect((await findType(db, ctx.workspaceId, line("Canon C700 FF")))?.name).not.toBe("Canon C70");
  });

  it("a catalog import teaches existing types the spellings rental houses use", async () => {
    const r = await importStandardCatalog(db, ctx, { sections: ["power"] });
    expect(r.aliasesAdded).toBeGreaterThan(0);
    const [bebob] = await db.select().from(s.equipmentType).where(eq(s.equipmentType.model, "V98micro"));
    expect(bebob!.aliases).toContain("BEBOB V-Mount Akku 98Wh V98micro");
  });
});
