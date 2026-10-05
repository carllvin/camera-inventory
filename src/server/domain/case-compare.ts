/**
 * Expected vs. actual case contents. Pure function: no database access, so it is
 * cheap to unit-test and reusable for AI return checks later (Phase 7).
 *
 * Matching rules:
 *  1. Lines for a specific equipment type claim items of exactly that type first.
 *  2. Category lines ("2 × batteries") then claim remaining items whose type is in
 *     that category or any subcategory.
 *  3. Whatever is left over is "extra". Bulk items count with their quantity.
 */

export interface ExpectedLine {
  id: string;
  label: string;
  quantity: number;
  equipmentTypeId: string | null;
  categoryId: string | null;
  sortOrder: number;
}

export interface CaseContentItem {
  id: string;
  equipmentTypeId: string;
  categoryId: string | null;
  quantity: number;
}

export interface LineResult {
  line: ExpectedLine;
  matched: number;
  missing: number;
  /** Items (with how many units of each) that satisfy this line. */
  items: { id: string; units: number }[];
}

export interface CaseComparison {
  lines: LineResult[];
  extras: { id: string; units: number }[];
  expectedTotal: number;
  matchedTotal: number;
  missingTotal: number;
  extraTotal: number;
  actualTotal: number;
  complete: boolean;
}

/** categoryId -> set of itself and all descendant ids. */
export type CategoryClosure = Map<string, Set<string>>;

export function buildCategoryClosure(categories: { id: string; parentId: string | null }[]): CategoryClosure {
  const children = new Map<string, string[]>();
  for (const c of categories) {
    if (!c.parentId) continue;
    children.set(c.parentId, [...(children.get(c.parentId) ?? []), c.id]);
  }
  const closure: CategoryClosure = new Map();
  const visit = (id: string): Set<string> => {
    const cached = closure.get(id);
    if (cached) return cached;
    const set = new Set<string>([id]);
    closure.set(id, set);
    for (const child of children.get(id) ?? []) for (const d of visit(child)) set.add(d);
    return set;
  };
  for (const c of categories) visit(c.id);
  return closure;
}

export function compareCase(expected: ExpectedLine[], items: CaseContentItem[], closure: CategoryClosure): CaseComparison {
  const remaining = new Map(items.map((i) => [i.id, i.quantity]));
  const ordered = [...expected].sort((a, b) => a.sortOrder - b.sortOrder);
  const results = new Map<string, LineResult>(ordered.map((l) => [l.id, { line: l, matched: 0, missing: 0, items: [] }]));

  const claim = (line: ExpectedLine, accepts: (i: CaseContentItem) => boolean) => {
    const r = results.get(line.id)!;
    for (const item of items) {
      if (r.matched >= line.quantity) break;
      const left = remaining.get(item.id)!;
      if (left <= 0 || !accepts(item)) continue;
      const units = Math.min(left, line.quantity - r.matched);
      remaining.set(item.id, left - units);
      r.matched += units;
      r.items.push({ id: item.id, units });
    }
  };

  for (const line of ordered) if (line.equipmentTypeId) claim(line, (i) => i.equipmentTypeId === line.equipmentTypeId);
  for (const line of ordered) {
    if (line.equipmentTypeId || !line.categoryId) continue;
    const allowed = closure.get(line.categoryId) ?? new Set([line.categoryId]);
    claim(line, (i) => i.categoryId !== null && allowed.has(i.categoryId));
  }

  const lines = ordered.map((l) => {
    const r = results.get(l.id)!;
    r.missing = Math.max(0, l.quantity - r.matched);
    return r;
  });
  const extras = items.filter((i) => remaining.get(i.id)! > 0).map((i) => ({ id: i.id, units: remaining.get(i.id)! }));
  const expectedTotal = lines.reduce((n, l) => n + l.line.quantity, 0);
  const matchedTotal = lines.reduce((n, l) => n + l.matched, 0);
  const extraTotal = extras.reduce((n, e) => n + e.units, 0);
  return {
    lines,
    extras,
    expectedTotal,
    matchedTotal,
    missingTotal: expectedTotal - matchedTotal,
    extraTotal,
    actualTotal: items.reduce((n, i) => n + i.quantity, 0),
    complete: matchedTotal === expectedTotal && extraTotal === 0,
  };
}
