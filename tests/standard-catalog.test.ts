/** Standard equipment catalog: data sanity and an idempotent, audited import. */
import { and, asc, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/server/db/schema";
import { STANDARD_CATALOG, sectionEntries } from "../src/server/catalog/standard-catalog";
import { DomainError, type Ctx } from "../src/server/domain/context";
import { findType } from "../src/server/domain/document-matching";
import { searchEquipmentTypes } from "../src/server/domain/equipment-types";
import { createEquipmentType } from "../src/server/domain/equipment-types";
import { importStandardCatalog, importStandardRentalHouses, standardCatalogStatus, standardRentalHouseStatus } from "../src/server/domain/standard-catalog";
import { STANDARD_RENTAL_HOUSES } from "../src/server/catalog/rental-houses";
import { findRentalHouse } from "../src/server/domain/document-matching";
import { createRentalHouse } from "../src/server/domain/rental-houses";
import { client, db, makeFixture, type Fixture } from "./helpers/db";

let f: Fixture;
let ctx: Ctx;

const compact = (v: string) => v.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const all = STANDARD_CATALOG.flatMap(sectionEntries);

beforeAll(async () => {
  f = await makeFixture();
  ctx = { workspaceId: f.ws.id, userId: f.user.id, role: "owner" };
});

afterAll(async () => {
  await client.end();
});

describe("catalog data", () => {
  it("covers the Tiffen cine filter range, each spelling naming only that filter", () => {
    const tiffen = all.filter((e) => e.manufacturer === "Tiffen" && e.category[1] === "Matte Boxes & Filters");
    expect(tiffen.length).toBeGreaterThan(250);
    for (const model of ["Black Pro-Mist 1/16 4x5.65", "Glimmerglass 5 4x5.65", "Soft/FX 1/2 6.6x6.6", "Smoque 2 4x5.65", "85N6 4x5.65", "Water White ND 0.9 4x5.65", "Graduated ND 0.6 Soft Edge Horizontal 4x5.65"])
      expect(tiffen.map((e) => e.model)).toContain(model);
    const owners = new Map<string, Set<string>>();
    for (const e of all)
      for (const v of [e.model, ...(e.aliases ?? [])]) owners.set(v.toLowerCase(), (owners.get(v.toLowerCase()) ?? new Set()).add(`${e.manufacturer} ${e.model}`));
    for (const e of tiffen) for (const a of e.aliases ?? []) expect([a, owners.get(a.toLowerCase())!.size]).toEqual([a, 1]);
  });

  it("has unique sections, models and names, and a category for every entry", () => {
    expect(new Set(STANDARD_CATALOG.map((c) => c.key)).size).toBe(STANDARD_CATALOG.length);
    expect(all.length).toBeGreaterThan(350);
    const models = all.map((e) => compact(`${e.manufacturer} ${e.model}`));
    expect(new Set(models).size).toBe(models.length);
    const names = all.map((e) => compact(e.name ?? `${e.manufacturer} ${e.model}`));
    expect(new Set(names).size).toBe(names.length);
    for (const e of all) {
      expect(e.category[0]).toBeTruthy();
      expect(e.category[1]).toBeTruthy();
      expect(e.model.trim()).toBe(e.model);
      for (const a of e.aliases ?? []) expect(a).toBe(a.replace(/\s+/g, " ").trim());
    }
  });

  it("expands lens series, keeps non-numeric focal lengths and marks discontinued models", () => {
    expect(all.find((e) => e.model === "Ultra Prime 8R T2.8")).toBeTruthy();
    expect(all.find((e) => e.model === "Master Anamorphic 180mm T2.8")!.formerly).toEqual(["Master Anamorphic 180mm T1.9"]);
    expect(all.find((e) => e.model === "Ultra 16 6mm T1.3")!.specs!.availability).toBe("discontinued");
    expect(all.find((e) => e.manufacturer === "bebob" && e.model === "B90cine")!.formerly).toContain("B98cine");
    expect(all.length).toBeGreaterThan(1500);
    // A T-stop learned later renames the generated model; the old one is kept as "formerly".
    expect(all.find((e) => e.model === "Panchro/i Classic 32mm T2.2")!.formerly).toEqual(["Panchro/i Classic 32mm"]);
  });

  it("lists lenses per focal length", () => {
    const sp = all.filter((e) => e.model.startsWith("Signature Prime "));
    expect(sp.map((e) => e.model)).toContain("Signature Prime 35mm T1.8");
    expect(sp.length).toBeGreaterThanOrEqual(16);
    expect(sp.find((e) => e.model === "Signature Prime 35mm T1.8")!.aliases).toEqual(expect.arrayContaining(["SP35", "Signature Prime 35"]));
  });
});

describe("import", () => {
  it("adds the chosen areas, reuses categories and skips types the workspace already has", async () => {
    // The fixture has "ARRI ALEXA 35" and a "Camera" root category; add a differently spelled Bolt and an archived Hi-5.
    await createEquipmentType(db, ctx, { manufacturer: "Teradek", model: "Bolt6 XT-750 TX" });
    const hi5 = await createEquipmentType(db, ctx, { manufacturer: "ARRI", model: "Hi 5", name: "ARRI Hi-5 Hand Unit" });
    await db.update(s.equipmentType).set({ archivedAt: new Date() }).where(eq(s.equipmentType.id, hi5.id));

    const before = await standardCatalogStatus(db, ctx);
    expect(before.find((x) => x.key === "cameras")!.present).toBe(1);

    const r = await importStandardCatalog(db, ctx, { sections: ["cameras", "video", "lens-control"] });
    const expected = ["cameras", "video", "lens-control"].reduce((n, k) => n + sectionEntries(STANDARD_CATALOG.find((c) => c.key === k)!).length, 0);
    expect(r.skipped).toBe(3); // ALEXA 35, Bolt TX, archived Hi-5
    expect(r.created).toBe(expected - 3);

    const types = await db.select().from(s.equipmentType).where(eq(s.equipmentType.workspaceId, ctx.workspaceId));
    expect(types.filter((t) => t.manufacturer === "ARRI" && t.model === "ALEXA 35")).toHaveLength(1);
    expect(types.filter((t) => compact(t.manufacturer + t.model) === "teradekbolt6xt750tx")).toHaveLength(1);
    expect(types.filter((t) => t.name === "ARRI Hi-5 Hand Unit")).toHaveLength(1); // archived one is not re-created
    const mini = types.find((t) => t.model === "ALEXA Mini LF")!;
    expect(mini.aliases).toContain("ALEXA Mini LF Body");
    expect(types.find((t) => t.model === "Black Pro-Mist 1/8 4x5.65")!.defaultTrackingMode).toBe("bulk");

    // Existing "Camera" root reused; missing subcategories created under it.
    const cats = await db.select().from(s.category).where(eq(s.category.workspaceId, ctx.workspaceId));
    expect(cats.filter((c) => c.name === "Camera" && c.parentId === null)).toHaveLength(1);
    const bodies = cats.find((c) => c.name === "Camera Bodies")!;
    expect(bodies.parentId).toBe(f.category.id);
    expect(mini.categoryId).toBe(bodies.id);

    // History: one summary event and one per created type, sharing a correlation id.
    const [summary] = await db.select().from(s.auditEvent).where(and(eq(s.auditEvent.workspaceId, ctx.workspaceId), eq(s.auditEvent.action, "catalog.imported")));
    expect(summary!.summary).toContain(`${r.created} equipment types added`);
    const typeEvents = await db
      .select()
      .from(s.auditEvent)
      .where(and(eq(s.auditEvent.correlationId, summary!.correlationId!), eq(s.auditEvent.action, "equipment_type.created")));
    expect(typeEvents).toHaveLength(r.created);
  });

  it("is safe to run again: existing types keep their data and only gain spellings", async () => {
    const [mini] = await db.select().from(s.equipmentType).where(and(eq(s.equipmentType.workspaceId, ctx.workspaceId), eq(s.equipmentType.model, "ALEXA Mini LF")));
    await db.update(s.equipmentType).set({ aliases: ["my own alias"] }).where(eq(s.equipmentType.id, mini!.id));
    const again = await importStandardCatalog(db, ctx, { sections: ["cameras"] });
    expect(again.created).toBe(0);
    const [after] = await db.select().from(s.equipmentType).where(eq(s.equipmentType.id, mini!.id));
    expect(after!.aliases[0]).toBe("my own alias"); // kept, catalog spellings only appended
    expect(after!).toMatchObject({ name: mini!.name, model: mini!.model, categoryId: mini!.categoryId });
    expect(again.aliasesAdded).toBeGreaterThan(0);
    expect((await importStandardCatalog(db, ctx, { sections: ["cameras"] })).aliasesAdded).toBe(0); // nothing new the second time
    expect((await standardCatalogStatus(db, ctx)).find((x) => x.key === "cameras")!.present).toBe(sectionEntries(STANDARD_CATALOG[0]!).length);
  });

  it("makes delivery-note spellings match the imported lenses", async () => {
    await importStandardCatalog(db, ctx, { sections: ["lenses"] });
    const byAlias = await findType(db, ctx.workspaceId, { catalogMatch: "SP35", description: "", manufacturer: null, model: null });
    expect(byAlias?.name).toBe("ARRI Signature Prime 35mm T1.8");
    const fuzzy = await findType(db, ctx.workspaceId, { catalogMatch: null, description: "ARRI Signature Prime 47mm", manufacturer: "ARRI", model: null });
    expect(fuzzy?.name).toBe("ARRI Signature Prime 47mm T1.8");
  });

  it("matches delivery-note spellings of Tiffen filters to the right strength and size", async () => {
    const ws = await makeFixture();
    const c: Ctx = { workspaceId: ws.ws.id, userId: ws.user.id, role: "owner" };
    await importStandardCatalog(db, c, { sections: ["lens-control"] });
    const find = (description: string, manufacturer: string | null = "Tiffen", model: string | null = null) =>
      findType(db, c.workspaceId, { catalogMatch: null, description, manufacturer, model }).then((t) => t?.name);
    expect(await find("Tiffen 4x5.65 Black Pro-Mist 1/4", "Tiffen", "Black Pro-Mist 1/4 4x5.65")).toBe("Tiffen Black Pro-Mist 1/4 4x5.65");
    expect(await find("Filter Glimmerglass 2 4x5.65", "Tiffen", "Glimmerglass 2 4x5.65")).toBe("Tiffen Glimmerglass 2 4x5.65");
    expect(await find("Tiffen 85N6 4x5.65")).toBe("Tiffen 85N6 4x5.65");
  });

  it("corrects untouched types imported under an earlier, wrong name — never edited ones", async () => {
    const ws = await makeFixture();
    const c: Ctx = { workspaceId: ws.ws.id, userId: ws.user.id, role: "owner" };
    // As imported by catalog v1: two wrong names, one of them edited by a person afterwards.
    for (const model of ["B98cine", "VS2-Cine Charger"]) {
      const [t] = await db.insert(s.equipmentType).values({ workspaceId: c.workspaceId, manufacturer: "bebob", model, name: `bebob ${model}` }).returning();
      await db.insert(s.auditEvent).values({ workspaceId: c.workspaceId, actorType: "user", actorUserId: c.userId, action: "equipment_type.created", entityType: "equipment_type", entityId: t!.id, summary: `Equipment type bebob ${model} created (standard catalog)` });
      if (model === "VS2-Cine Charger") {
        await db.insert(s.auditEvent).values({ workspaceId: c.workspaceId, actorType: "user", actorUserId: c.userId, action: "equipment_type.updated", entityType: "equipment_type", entityId: t!.id, summary: "edited by hand" });
      }
    }
    const r = await importStandardCatalog(db, c, { sections: ["power"] });
    expect(r.corrected).toBe(1);
    const bebob = await db.select().from(s.equipmentType).where(and(eq(s.equipmentType.workspaceId, c.workspaceId), eq(s.equipmentType.manufacturer, "bebob")));
    expect(bebob.filter((t) => t.model === "B98cine")).toHaveLength(0);
    expect(bebob.filter((t) => t.model === "B90cine")).toHaveLength(1);
    // The edited one stays, and its corrected name is not created next to it.
    expect(bebob.filter((t) => t.model === "VS2-Cine Charger")).toHaveLength(1);
    expect(bebob.filter((t) => t.model === "VS2")).toHaveLength(0);
    const [ev] = await db.select().from(s.auditEvent).where(and(eq(s.auditEvent.workspaceId, c.workspaceId), eq(s.auditEvent.action, "equipment_type.updated"), eq(s.auditEvent.summary, "bebob B98cine corrected to bebob B90cine (standard catalog)")));
    expect(ev!.changes).toMatchObject({ model: { from: "B98cine", to: "B90cine" } });
  });

  it("type picker search: words in any order, aliases and typos", async () => {
    const names = async (q: string) => (await searchEquipmentTypes(db, ctx, q, 5)).map((r) => r.name);
    expect((await names("SP35"))[0]).toBe("ARRI Signature Prime 35mm T1.8");
    expect(await names("35 signature")).toContain("ARRI Signature Prime 35mm T1.8");
    expect(await names("supreme 29")).toContain("ZEISS Supreme Prime 29mm T1.5");
    expect((await names("Mini LF"))[0]).toBe("ARRI ALEXA Mini LF");
    expect(await names("Signiture Prime 47")).toContain("ARRI Signature Prime 47mm T1.8");
    expect(await names("")).toHaveLength(5);
  });

  it("needs an admin and known areas", async () => {
    await expect(importStandardCatalog(db, { ...ctx, role: "member" }, { sections: ["power"] })).rejects.toBeInstanceOf(DomainError);
    await expect(importStandardCatalog(db, ctx, { sections: ["nope"] })).rejects.toThrow(/Unknown catalog area/);
    await expect(importStandardCatalog(db, ctx, { sections: [] })).rejects.toThrow();
    const other = await makeFixture();
    const before = await db.select().from(s.equipmentType).where(and(eq(s.equipmentType.workspaceId, other.ws.id), isNull(s.equipmentType.archivedAt)));
    expect(before).toHaveLength(2); // nothing leaked into another workspace
  });
});

describe("standard rental houses", () => {
  it("has regions with houses whose names and aliases never collide", () => {
    expect(STANDARD_RENTAL_HOUSES.map((r) => r.key)).toEqual(["de", "at-ch", "intl"]);
    const owner = new Map<string, string>();
    for (const h of STANDARD_RENTAL_HOUSES.flatMap((r) => r.houses)) {
      for (const v of [h.name, ...(h.aliases ?? [])]) {
        const k = compact(v);
        if (owner.has(k)) expect(owner.get(k)).toBe(h.name);
        owner.set(k, h.name);
      }
      expect(h).not.toHaveProperty("sources");
    }
  });

  it("imports per region, skips houses the workspace has, matches delivery-note senders", async () => {
    const ws = await makeFixture();
    const c: Ctx = { workspaceId: ws.ws.id, userId: ws.user.id, role: "owner" };
    await createRentalHouse(db, c, { name: "Cinemobil" }); // own spelling of Cine-Mobil
    const de = STANDARD_RENTAL_HOUSES.find((r) => r.key === "de")!;

    const r = await importStandardRentalHouses(db, c, { regions: ["de"] });
    expect(r.skipped).toBe(1);
    expect(r.created).toBe(de.houses.length - 1);
    const houses = await db.select().from(s.rentalHouse).where(eq(s.rentalHouse.workspaceId, c.workspaceId));
    expect(houses.filter((h) => compact(h.name).startsWith("cinemobil"))).toHaveLength(1);
    expect(houses.find((h) => h.name === "MBF Filmtechnik")!.aliases).toContain("MBF Filmtechnik GmbH");

    // A legal name printed on delivery notes finds the imported house.
    const arri = await findRentalHouse(db, c.workspaceId, "ARRI Rental Deutschland GmbH", null);
    expect(houses.find((h) => h.id === arri)!.name).toBe("ARRI Rental");

    expect((await importStandardRentalHouses(db, c, { regions: ["de"] })).created).toBe(0);
    expect((await standardRentalHouseStatus(db, c)).find((x) => x.key === "de")!.present).toBe(de.houses.length);
    // The first of the two imports (rows have no inherent order without ORDER BY).
    const [ev] = await db.select().from(s.auditEvent).where(and(eq(s.auditEvent.workspaceId, c.workspaceId), eq(s.auditEvent.action, "catalog.imported"))).orderBy(asc(s.auditEvent.id));
    expect(ev!.summary).toContain(`${de.houses.length - 1} added`);
    await expect(importStandardRentalHouses(db, { ...c, role: "member" }, { regions: ["de"] })).rejects.toBeInstanceOf(DomainError);
  });

  it("matches the Cine-Mobil branch name from the uploaded delivery note", async () => {
    const ws = await makeFixture();
    const c: Ctx = { workspaceId: ws.ws.id, userId: ws.user.id, role: "owner" };
    await importStandardRentalHouses(db, c, { regions: ["de"] });
    const id = await findRentalHouse(db, c.workspaceId, "Cine-Mobil GmbH - NL Köln", null);
    const [h] = await db.select().from(s.rentalHouse).where(eq(s.rentalHouse.id, id!));
    expect(h!.name).toBe("Cine-Mobil");
  });
});
