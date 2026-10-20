/** The types list bundles a lens series into one card; a click shows its focal lengths. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Ctx } from "../src/server/domain/context";
import {
  createEquipmentType,
  listEquipmentTypeGroups,
  seriesOf,
} from "../src/server/domain/equipment-types";
import { client, db, makeFixture, type Fixture } from "./helpers/db";

let f: Fixture;
let ctx: Ctx;

beforeAll(async () => {
  f = await makeFixture();
  ctx = { workspaceId: f.ws.id, userId: f.user.id, role: "owner" };
  for (const model of [
    "Master Prime 75mm T1.3",
    "Master Prime 18mm T1.3",
    "Master Prime 135mm T1.3",
    "Master Prime 25mm",
  ]) {
    await createEquipmentType(db, ctx, { manufacturer: "Grp Optics", model });
  }
  await createEquipmentType(db, ctx, {
    manufacturer: "Grp Optics",
    model: "Ultra Prime 32mm T1.9",
  });
  await createEquipmentType(db, ctx, {
    manufacturer: "Grp Cams",
    model: "Cine Body X",
  });
  await createEquipmentType(db, ctx, {
    manufacturer: "Grp Cams",
    model: "Master Prime 50mm T1.3",
  });
});

afterAll(async () => {
  await client.end();
});

describe("seriesOf", () => {
  it("reads the series and focal length from the model", () => {
    expect(seriesOf("Master Prime 25mm T1.3")).toEqual({
      series: "Master Prime",
      size: 25,
    });
    expect(seriesOf("Ultra 16 9.5mm T1.3")).toEqual({
      series: "Ultra 16",
      size: 9.5,
    });
    expect(seriesOf("Panchro/i Classic FF 32mm")).toEqual({
      series: "Panchro/i Classic FF",
      size: 32,
    });
    expect(seriesOf("ALEXA 35")).toBeNull();
    expect(seriesOf("Optimo 24-290 T2.8")).toBeNull();
    expect(seriesOf("100mm")).toBeNull();
  });
});

describe("listEquipmentTypeGroups", () => {
  it("bundles a maker's series, sorted by focal length; other types stay on their own", async () => {
    const groups = (
      await listEquipmentTypeGroups(db, ctx, { q: "grp" })
    ).filter((g) => g.manufacturer.startsWith("Grp"));
    const mp = groups.find(
      (g) => g.manufacturer === "Grp Optics" && g.series === "Master Prime",
    );
    expect(mp?.members.map((m) => m.model)).toEqual([
      "Master Prime 18mm T1.3",
      "Master Prime 25mm",
      "Master Prime 75mm T1.3",
      "Master Prime 135mm T1.3",
    ]);
    // Another maker's series of the same name is its own group.
    expect(
      groups.find(
        (g) => g.manufacturer === "Grp Cams" && g.series === "Master Prime",
      )?.members,
    ).toHaveLength(1);
    expect(
      groups
        .find((g) => g.manufacturer === "Grp Cams" && g.series === null)
        ?.members.map((m) => m.model),
    ).toEqual(["Cine Body X"]);
    expect(groups).toHaveLength(4);
  });

  it("pages by group, so a series is never split", async () => {
    const all = await listEquipmentTypeGroups(db, ctx, { q: "grp" });
    const pages = [
      ...(await listEquipmentTypeGroups(db, ctx, {
        q: "grp",
        limit: 2,
        offset: 0,
      })),
      ...(await listEquipmentTypeGroups(db, ctx, {
        q: "grp",
        limit: 2,
        offset: 2,
      })),
      ...(await listEquipmentTypeGroups(db, ctx, {
        q: "grp",
        limit: 2,
        offset: 4,
      })),
    ];
    expect(pages.map((g) => [g.key, g.members.length])).toEqual(
      all.map((g) => [g.key, g.members.length]),
    );
  });

  it("filters before grouping", async () => {
    const groups = await listEquipmentTypeGroups(db, ctx, {
      q: "grp optics master prime 75",
    });
    expect(groups.flatMap((g) => g.members.map((m) => m.model))).toContain(
      "Master Prime 75mm T1.3",
    );
  });
});

describe("catalog pictures", () => {
  it("are found by model, or by lens series for every focal length", async () => {
    const { catalogImageLookup } = await import("../src/server/catalog/images");
    const { find } = catalogImageLookup({
      entries: { "ARRI|ALEXA 35": { url: "https://x/a35.png" } },
      series: { "ARRI|Signature Prime": { url: "https://x/sp.png", background: "white" } },
    });
    expect(find({ manufacturer: "ARRI", model: "Alexa-35" })?.url).toBe("https://x/a35.png");
    expect(find({ manufacturer: "ARRI", model: "Signature Prime 47mm T1.8" })?.url).toBe("https://x/sp.png");
    expect(find({ manufacturer: "ZEISS", model: "Signature Prime 47mm T1.8" })).toBeNull();
    expect(find({ manufacturer: "ARRI", model: "ALEXA Mini" })).toBeNull();
  });
});
