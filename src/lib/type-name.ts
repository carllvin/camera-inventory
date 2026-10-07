/** Placeholder makers that say nothing: the model alone is the name ("BNC Cable 1 m", not "Generic BNC Cable 1 m"). */
const NO_MAKER = new Set(["generic", "generisch", "no name", "noname", "unbranded", "diverse", "various", "-"]);

export function isNoMaker(manufacturer: string) {
  return NO_MAKER.has(manufacturer.trim().toLowerCase());
}

/** Display name of an equipment type made from manufacturer and model. */
export function typeDisplayName(manufacturer: string, model: string) {
  return isNoMaker(manufacturer) ? model.trim() : `${manufacturer.trim()} ${model.trim()}`;
}
