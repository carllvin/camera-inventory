/**
 * Standard rental houses: professional camera rental companies, importable per
 * region like the equipment catalog. Aliases are the legal names and branch
 * spellings printed on delivery notes, so documents match the sender out of the box.
 * Data: ./data/rental-houses.json (researched; contact data only where verified).
 */
import data from "./data/rental-houses.json";

export interface StandardRentalHouse {
  name: string;
  shortName?: string;
  aliases?: string[];
  website?: string;
  address?: string;
  phone?: string;
  email?: string;
  notes?: string;
}

export interface RentalHouseRegion {
  key: string;
  label: string;
  description: string;
  houses: StandardRentalHouse[];
}

type RawRegion = Omit<RentalHouseRegion, "houses"> & { houses: (StandardRentalHouse & { sources?: string[] })[] };

export const STANDARD_RENTAL_HOUSES: RentalHouseRegion[] = (data as unknown as { regions: RawRegion[] }).regions.map((r) => ({
  key: r.key,
  label: r.label,
  description: r.description,
  houses: r.houses.map(({ sources: _sources, ...h }) => h),
}));

export function rentalHouseRegion(key: string) {
  return STANDARD_RENTAL_HOUSES.find((r) => r.key === key);
}
