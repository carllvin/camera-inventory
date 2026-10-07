/** Fluid tracking: a serial number makes an individual, without one units are interchangeable. */

export type Groupable = {
  id: string;
  projectId?: string | null;
  equipmentTypeId: string;
  serialNumber: string | null;
  quantity: number;
  rentalHouseId: string | null;
  caseId: string | null;
  status: string;
  condition: string;
};

/**
 * Items with a serial number are individuals and get a row each. Items without
 * one are interchangeable: those of the same type, owner, case, status and
 * condition collapse into one row with their total number of units.
 */
export function groupUnits<T extends Groupable>(items: T[]) {
  const rows: (T & { itemIds: string[]; units: number })[] = [];
  const byKey = new Map<string, (typeof rows)[number]>();
  for (const i of items) {
    if (i.serialNumber) {
      rows.push({ ...i, itemIds: [i.id], units: i.quantity });
      continue;
    }
    const key = [i.equipmentTypeId, i.rentalHouseId, i.projectId, i.caseId, i.status, i.condition].join("|");
    const row = byKey.get(key);
    if (row) {
      // The row stands for its largest entry (that's where links and actions go).
      const largest = i.quantity > row.quantity;
      row.itemIds.push(i.id);
      row.units += i.quantity;
      if (largest) Object.assign(row, { ...i, itemIds: row.itemIds, units: row.units });
    } else {
      const created = { ...i, itemIds: [i.id], units: i.quantity };
      byKey.set(key, created);
      rows.push(created);
    }
  }
  return rows;
}
