/** Background check for product pictures: cut out, white, or anything else. */
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  backgroundRank,
  detectBackground,
} from "../src/server/media/background";

const product = {
  input: {
    create: {
      width: 200,
      height: 120,
      channels: 3 as const,
      background: "#202024",
    },
  },
  left: 100,
  top: 90,
};

describe("detectBackground", () => {
  it("tells cut-out, white and busy pictures apart", async () => {
    const cutOut = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([product])
      .png()
      .toBuffer();
    const white = await sharp({
      create: { width: 400, height: 300, channels: 3, background: "#fbfbfb" },
    })
      .composite([product])
      .jpeg()
      .toBuffer();
    const scene = await sharp({
      create: { width: 400, height: 300, channels: 3, background: "#5a7d3c" },
    })
      .composite([product])
      .jpeg()
      .toBuffer();
    expect(await detectBackground(cutOut)).toBe("transparent");
    expect(await detectBackground(white)).toBe("white");
    expect(await detectBackground(scene)).toBe("other");
    expect(await detectBackground(Buffer.from("not an image"))).toBeNull();
  });

  it("ranks clean backgrounds first", () => {
    expect(
      ["other", null, "white", "transparent"].sort(
        (a, b) => backgroundRank(a) - backgroundRank(b),
      ),
    ).toEqual(["transparent", "white", "other", null]);
  });
});
