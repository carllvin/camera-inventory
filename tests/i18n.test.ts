import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeT, translateMessage } from "@/lib/i18n/core";
import { de } from "@/lib/i18n/de";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(p) ? [p] : [];
  });
}

/** Every `t("…")` text in the app. */
function uiTexts() {
  const found = new Map<string, string>();
  for (const f of files("src")) {
    if (f.includes(`${join("lib", "i18n")}`)) continue;
    const src = readFileSync(f, "utf8");
    for (const m of src.replace(/^\s*(\/\/|\*|\/\*).*$/gm, "").matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) found.set(JSON.parse(`"${m[1]}"`), f);
  }
  return found;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("translations", () => {
  it("falls back to English and fills placeholders", () => {
    const t = makeT({ "{n} pieces": "{n} Stück" });
    expect(t("{n} pieces", { n: 3 })).toBe("3 Stück");
    expect(t("Unknown text {x}", { x: 1 })).toBe("Unknown text 1");
    expect(makeT(null)("Save")).toBe("Save");
  });

  it("translates finished messages through patterns, the most specific first", () => {
    const dict = {
      "{item} packed into {set}": "{item} in {set} gepackt",
      "{item} packed into {set} (moved)": "{item} in {set} gepackt (umgepackt)",
      "Undo: {msg}": "Rückgängig: {msg}",
      "Saved.": "Gespeichert.",
    };
    expect(translateMessage(dict, "ALEXA 35 packed into A-Cam")).toBe("ALEXA 35 in A-Cam gepackt");
    expect(translateMessage(dict, "ALEXA 35 packed into A-Cam (moved)")).toBe("ALEXA 35 in A-Cam gepackt (umgepackt)");
    expect(translateMessage(dict, "Undo: ALEXA 35 packed into A-Cam")).toBe("Rückgängig: ALEXA 35 in A-Cam gepackt");
    expect(translateMessage(dict, "Saved.")).toBe("Gespeichert.");
    expect(translateMessage(dict, "Something new")).toBe("Something new");
    expect(translateMessage(null, "Saved.")).toBe("Saved.");
  });

  it("has a German text for every interface text", () => {
    const missing = [...uiTexts()].filter(([k]) => !(k in de)).map(([k, f]) => `${f}: ${k}`);
    expect(missing).toEqual([]);
  });

  it("keeps the placeholders of every entry", () => {
    const wrong = Object.entries(de).filter(([en, g]) => placeholders(en).join() !== placeholders(g).join()).map(([en]) => en);
    expect(wrong).toEqual([]);
  });
});
