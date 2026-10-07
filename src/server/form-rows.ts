/**
 * Ticked rows of an equipment checklist: `row` = row key, `ids_<key>` = the
 * entries behind it, `units_<key>` = how many (only for units without serial).
 */
export function readRows(fd: FormData) {
  const items: { id: string }[] = [];
  const groups: { itemIds: string[]; units: number }[] = [];
  for (const key of fd.getAll("row").map(String)) {
    const ids = String(fd.get(`ids_${key}`) ?? "").split(",").filter(Boolean);
    const raw = fd.get(`units_${key}`);
    if (raw === null) items.push(...ids.map((id) => ({ id })));
    else groups.push({ itemIds: ids, units: Math.max(1, Math.floor(Number(raw)) || 1) });
  }
  return { items, groups };
}
