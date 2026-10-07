/** Sort choices for the set and document lists ("" = the list's own order). */
export const SET_SORTS = [
  { value: "progress", label: "Sort: incomplete first" },
  { value: "project", label: "Sort: project" },
] as const;

export const DOCUMENT_SORTS = [
  { value: "open", label: "Sort: open first" },
  { value: "number", label: "Sort: number" },
  { value: "oldest", label: "Sort: oldest first" },
] as const;

type SetLike = { name: string; projectName: string; comparison: { matchedTotal: number; expectedTotal: number; missingTotal: number } };

export function sortSets<T extends SetLike>(sets: T[], sort?: string) {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name);
  const done = (c: T) => (c.comparison.expectedTotal ? c.comparison.matchedTotal / c.comparison.expectedTotal : 1);
  const out = [...sets];
  if (sort === "progress") return out.sort((a, b) => done(a) - done(b) || b.comparison.missingTotal - a.comparison.missingTotal || byName(a, b));
  if (sort === "project") return out.sort((a, b) => a.projectName.localeCompare(b.projectName) || byName(a, b));
  return out.sort(byName);
}

type DocLike = { status: string; documentNumber: string | null; title: string | null };

export function sortDocuments<T extends DocLike>(docs: T[], sort?: string) {
  const out = [...docs];
  const open = (d: T) => (["uploaded", "processing", "extracted", "failed"].includes(d.status) ? 0 : 1);
  if (sort === "open") return out.sort((a, b) => open(a) - open(b));
  if (sort === "number") return out.sort((a, b) => (a.documentNumber ?? a.title ?? "").localeCompare(b.documentNumber ?? b.title ?? "", undefined, { numeric: true }));
  if (sort === "oldest") return out.reverse();
  return out; // newest first, as listed
}
