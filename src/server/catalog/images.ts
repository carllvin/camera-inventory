/**
 * Reference pictures for catalog products: the manufacturer's (or an authorized
 * dealer's) product shot, ideally cut out or on white. Only the address is stored
 * here; a workspace downloads the picture into its own storage when it uses it.
 *
 * data/images.json: entries are keyed "manufacturer|model", lens series
 * "manufacturer|series" (one picture for every focal length of the series).
 */
import images from "./data/images.json";
import { seriesOf } from "../domain/equipment-types";
import { compact } from "../domain/standard-catalog";

export interface CatalogImage {
  url: string;
  /** Product page the picture was taken from. */
  page?: string;
  background?: "transparent" | "white" | "other";
}

type ImageData = {
  entries: Record<string, CatalogImage>;
  series: Record<string, CatalogImage>;
};

/** Lookup by manufacturer and model (or its lens series), ignoring case, spaces and punctuation. */
export function catalogImageLookup(data: ImageData) {
  const index = (rows: Record<string, CatalogImage>) =>
    new Map(
      Object.entries(rows).map(([k, v]) => [compact(k.replace("|", " ")), v]),
    );
  const entries = index(data.entries);
  const series = index(data.series);
  const find = (t: {
    manufacturer: string;
    model: string;
  }): CatalogImage | null => {
    const own = entries.get(compact(`${t.manufacturer} ${t.model}`));
    if (own) return own;
    const s = seriesOf(t.model);
    return (s && series.get(compact(`${t.manufacturer} ${s.series}`))) || null;
  };
  return { find, size: entries.size + series.size };
}

const catalog = catalogImageLookup(images as ImageData);
export const catalogImageCount = catalog.size;
/** The catalog picture for a type. */
export const catalogImageFor = catalog.find;
