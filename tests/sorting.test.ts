import { describe, expect, it } from "vitest";
import { sortDocuments, sortSets } from "../src/lib/sorting";

const set = (name: string, projectName: string, matched: number, expected: number) => ({ name, projectName, comparison: { matchedTotal: matched, expectedTotal: expected, missingTotal: expected - matched } });

describe("list sorting", () => {
  it("sorts sets by name, progress or project", () => {
    const sets = [set("B-Cam", "Film", 8, 8), set("A-Cam", "Film", 7, 8), set("Video", "Ad", 2, 10)];
    expect(sortSets(sets).map((s) => s.name)).toEqual(["A-Cam", "B-Cam", "Video"]);
    expect(sortSets(sets, "progress").map((s) => s.name)).toEqual(["Video", "A-Cam", "B-Cam"]);
    expect(sortSets(sets, "project").map((s) => s.name)).toEqual(["Video", "A-Cam", "B-Cam"]);
  });

  it("sorts documents: open first, by number (natural), oldest first", () => {
    const docs = [
      { status: "confirmed", documentNumber: "LS-10", title: null },
      { status: "extracted", documentNumber: "LS-9", title: null },
      { status: "confirmed", documentNumber: "LS-100", title: null },
    ];
    expect(sortDocuments(docs, "open")[0]!.documentNumber).toBe("LS-9");
    expect(sortDocuments(docs, "number").map((d) => d.documentNumber)).toEqual(["LS-9", "LS-10", "LS-100"]);
    expect(sortDocuments(docs, "oldest").map((d) => d.documentNumber)).toEqual(["LS-100", "LS-9", "LS-10"]);
  });
});
