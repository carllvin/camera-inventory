import type { Dict, Locale } from "./core";
import { de } from "./de";
import { categoriesDe, genericNamesDe } from "./de/catalog";

/** null = English (the texts in the code). */
export function dictionaryFor(locale: Locale): Dict | null {
  return locale === "de" ? de : null;
}

const namesDe: Dict = { ...categoriesDe, ...genericNamesDe };

/** Names of categories and brandless equipment in the user's language (exact names only; brands stay). */
export function namesFor(locale: Locale): Dict | null {
  return locale === "de" ? namesDe : null;
}
