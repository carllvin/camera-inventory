import type { Dict, Locale } from "./core";
import { de } from "./de";

/** null = English (the texts in the code). */
export function dictionaryFor(locale: Locale): Dict | null {
  return locale === "de" ? de : null;
}
