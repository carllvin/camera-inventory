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

  it("reads what follows \"f./für/for\" as what a part fits, not as the part", async () => {
    await createEquipmentType(db, ctx, { manufacturer: "ARRI", model: "ALEXA Mini LF" });
    await createEquipmentType(db, ctx, { manufacturer: "ARRI", model: "OCU-1" });
    await createEquipmentType(db, ctx, { manufacturer: "ARRI", model: "KC-50-S Power Cable 24V straight" });
    expect((await findType(db, ctx.workspaceId, line("ARRI Kabel Power KC-50-S 24V straight f. Alexa Mini/LF/35/Amira")))?.name).toBe("ARRI KC-50-S Power Cable 24V straight");
    // Nothing else fits: better no match than the device the part is for.
    expect((await findType(db, ctx.workspaceId, line("ARRI Rosette Bracket f. OCU-1")))?.name).not.toBe("ARRI OCU-1");
    expect((await findType(db, ctx.workspaceId, line("SANDISK USB-Stick für ALEXA Mini LF")))?.name).not.toBe("ARRI ALEXA Mini LF");
    // The product itself is still found by its model number.
    expect((await findType(db, ctx.workspaceId, line("ARRI ALEXA MINI LF Body")))?.name).toBe("ARRI ALEXA Mini LF");
  });

  it("a line written exactly like a known spelling goes to that type first", async () => {
    await createEquipmentType(db, ctx, { manufacturer: "ARRI", model: "PL Mount" });
    await createEquipmentType(db, ctx, { manufacturer: "ARRI", model: "LPL Mount (LBUS)", aliases: "ARRI LPL Mount f. ALEXA Mini / 35 / Amira" });
    expect((await findType(db, ctx.workspaceId, line("ARRI LPL Mount f. ALEXA Mini / 35 / Amira")))?.name).toBe("ARRI LPL Mount (LBUS)");
    // Two types with the same spelling: a person decides.
    await createEquipmentType(db, ctx, { manufacturer: "Generic", model: "Neck Strap", aliases: "Umhängegurt" });
    await createEquipmentType(db, ctx, { manufacturer: "ARRI", model: "WCU-4 Neck Strap", aliases: "Umhängegurt" });
    expect(await findType(db, ctx.workspaceId, line("Umhängegurt"))).toBeNull();
  });

  it("does not take a short model inside a longer one", async () => {
    expect((await findType(db, ctx.workspaceId, line("Canon C700 FF")))?.name).not.toBe("Canon C70");
  });

  it("a word of a longer model is not a different model number", async () => {
    await createEquipmentType(db, ctx, { manufacturer: "Cooke", model: "S7/i 25mm T2" });
    await createEquipmentType(db, ctx, { manufacturer: "Cooke", model: "5/i 25mm T1.4" });
    expect((await findType(db, ctx.workspaceId, line("Cooke S7/i 25mm")))?.name).toBe("Cooke S7/i 25mm T2");
    await createEquipmentType(db, ctx, { manufacturer: "ZEISS", model: "CP.3 25mm T2.1" });
    await createEquipmentType(db, ctx, { manufacturer: "ZEISS", model: "CP.2 25mm T2.1" });
    expect((await findType(db, ctx.workspaceId, line("Zeiss CP3 25mm")))?.name).toBe("ZEISS CP.3 25mm T2.1");
    await createEquipmentType(db, ctx, { manufacturer: "Sony", model: "Alpha 7S III" });
    expect((await findType(db, ctx.workspaceId, line("Sony Alpha 7R III")))?.name).not.toBe("Sony Alpha 7S III");
  });

  it("between two close names, the one whose words are all on the line wins", async () => {
    await createEquipmentType(db, ctx, { manufacturer: "ZEISS", model: "Supreme Prime 18mm T1.5" });
    await createEquipmentType(db, ctx, { manufacturer: "ZEISS", model: "Supreme Prime Radiance 18mm T1.5" });
    expect((await findType(db, ctx.workspaceId, line("18mm Zeiss Supreme Prime T1.5")))?.name).toBe("ZEISS Supreme Prime 18mm T1.5");
    expect((await findType(db, ctx.workspaceId, line("Zeiss Supreme Prime Radiance 18mm")))?.name).toBe("ZEISS Supreme Prime Radiance 18mm T1.5");
    // Model words written together on the line ("CP3" for "CP.3") count too; the XD has a word the line lacks.
    await createEquipmentType(db, ctx, { manufacturer: "ZEISS", model: "CP.3 35mm T2.1", aliases: "Compact Prime CP.3 35mm" });
    await createEquipmentType(db, ctx, { manufacturer: "ZEISS", model: "CP.3 XD 35mm T2.1", aliases: ["Compact Prime CP.3 XD 35mm", "ZEISS CP.3 XD 35mm", "CP3 XD 35mm"] });
    expect((await findType(db, ctx.workspaceId, line("Zeiss Compact Prime CP3 35mm")))?.name).toBe("ZEISS CP.3 35mm T2.1");
  });

  it("a maker the rental house writes in front of another maker's product does not rule it out", async () => {
    await createEquipmentType(db, ctx, { manufacturer: "ZEISS", model: "Ultra Prime 100mm T1.9", aliases: "ARRI Ultra Prime 100mm" });
    await createEquipmentType(db, ctx, { manufacturer: "ARRI", model: "Classic Macro 100mm T3" });
    expect((await findType(db, ctx.workspaceId, line("ARRI Ultra Prime 100mm T1.9")))?.name).toBe("ZEISS Ultra Prime 100mm T1.9");
    // The type's own maker in front of an alias is no extra hint: the 6K is still found.
    await createEquipmentType(db, ctx, { manufacturer: "Blackmagic Design", model: "Pocket Cinema Camera", aliases: "Blackmagic Pocket Cinema Camera MFT" });
    await createEquipmentType(db, ctx, { manufacturer: "Blackmagic Design", model: "Pocket Cinema Camera 6K", aliases: "BMPCC6K" });
    expect((await findType(db, ctx.workspaceId, line("Blackmagic Pocket Cinema Camera 6K (BMPCC6K)")))?.name).toBe("Blackmagic Design Pocket Cinema Camera 6K");
  });

  it("a catalog import teaches existing types the spellings rental houses use", async () => {
    const r = await importStandardCatalog(db, ctx, { sections: ["power"] });
    expect(r.aliasesAdded).toBeGreaterThan(0);
    const [bebob] = await db.select().from(s.equipmentType).where(eq(s.equipmentType.model, "V98micro"));
    expect(bebob!.aliases).toContain("BEBOB V-Mount Akku 98Wh V98micro");
  });
});
