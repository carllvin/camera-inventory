/**
 * Standard equipment catalog: common camera-department equipment types from
 * well-known manufacturers, importable per workspace (Settings / onboarding).
 *
 * The data lives in ./data/<section>.json (one file per import area):
 *  - entries: one equipment type each;
 *  - lensSeries: expanded here to one type per focal length, because rental
 *    houses list lenses per focal length with their own serials.
 * Aliases are the short / German / part-number spellings seen on delivery notes;
 * they make document matching work out of the box. `formerly` lists model names
 * an earlier catalog version used for the same product (corrections), so an
 * untouched type imported from that version can be renamed instead of duplicated.
 *
 * Raise STANDARD_CATALOG_VERSION when the data changes; re-importing only adds
 * what a workspace does not have yet.
 */
import cameras from "./data/cameras.json";
import cables from "./data/cables.json";
import lensControl from "./data/lens-control.json";
import lenses from "./data/lenses.json";
import power from "./data/power.json";
import support from "./data/support.json";
import video from "./data/video.json";

export const STANDARD_CATALOG_VERSION = 2;

export interface CatalogEntry {
  manufacturer: string;
  model: string;
  /** Display name; defaults to "manufacturer model". */
  name?: string;
  aliases?: string[];
  specs?: Record<string, string | number>;
  bulk?: boolean;
  discontinued?: boolean;
  /** Model names of the same product in earlier catalog versions. */
  formerly?: string[];
}

interface LensSeries {
  manufacturer: string;
  series: string;
  /** [focal length, T-stop or null]; non-numeric focal lengths ("8R") keep their label. */
  focals: [number | string, string | null][];
  mount?: string;
  format?: string;
  squeeze?: string;
  /** Abbreviations: "SP" -> "SP35", "SP 35". */
  short?: string[];
  /** Alternative series names: "ARRI/Zeiss Master Prime" -> "ARRI/Zeiss Master Prime 35mm". */
  extraSeries?: string[];
  discontinued?: boolean;
  /** Focal length -> model name used by an earlier version (e.g. a corrected T-stop). */
  formerly?: Record<string, string>;
}

interface DataGroup {
  category: [string, string];
  entries?: CatalogEntry[];
  lensSeries?: LensSeries[];
}

interface DataSection {
  key: string;
  label: string;
  description: string;
  groups: DataGroup[];
}

export interface CatalogGroup {
  /** [root category, subcategory] - created when missing, matched by name otherwise. */
  category: [string, string];
  entries: CatalogEntry[];
}

export interface CatalogSection {
  key: string;
  label: string;
  description: string;
  groups: CatalogGroup[];
}

function expandSeries(s: LensSeries): CatalogEntry[] {
  return s.focals.map(([mm, t]) => {
    const unit = typeof mm === "number" ? "mm" : ""; // "8R" stays "8R"
    const model = `${s.series} ${mm}${unit}${t ? ` ${t}` : ""}`;
    const aliases = [
      `${s.series} ${mm}`,
      `${s.series} ${mm}${unit}`,
      ...(s.short ?? []).flatMap((sh) => [`${sh}${mm}`, `${sh} ${mm}`]),
      ...(s.extraSeries ?? []).map((x) => `${x} ${mm}${unit}`),
    ]
      .map((a) => a.replace(/\s+/g, " ").trim())
      .filter((a) => a.toLowerCase() !== model.toLowerCase());
    const specs: Record<string, string | number> = { focal_length_mm: mm };
    if (t) specs.t_stop = t.replace(/^T/, "");
    if (s.mount) specs.mount = s.mount;
    if (s.format) specs.format = s.format;
    if (s.squeeze) specs.squeeze = s.squeeze;
    const formerly = s.formerly?.[String(mm)];
    return {
      manufacturer: s.manufacturer,
      model,
      aliases: [...new Set(aliases)],
      specs,
      ...(s.discontinued ? { discontinued: true } : {}),
      ...(formerly ? { formerly: [formerly] } : {}),
    };
  });
}

function load(d: DataSection): CatalogSection {
  return {
    key: d.key,
    label: d.label,
    description: d.description,
    groups: d.groups.map((g) => ({
      category: g.category,
      entries: [...(g.lensSeries ?? []).flatMap(expandSeries), ...(g.entries ?? [])].map((e) =>
        e.discontinued ? { ...e, specs: { ...e.specs, availability: "discontinued" } } : e,
      ),
    })),
  };
}

export const STANDARD_CATALOG: CatalogSection[] = [cameras, lenses, lensControl, video, power, support, cables].map((d) => load(d as unknown as DataSection));

export function catalogSection(key: string) {
  return STANDARD_CATALOG.find((s) => s.key === key);
}

export function sectionEntries(section: CatalogSection) {
  return section.groups.flatMap((g) => g.entries.map((e) => ({ ...e, category: g.category })));
}
