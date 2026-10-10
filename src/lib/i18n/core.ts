/**
 * Translation core, shared by server and client.
 *
 * The English text is the key: `t("Add equipment")` looks the text up in the
 * German dictionary and falls back to the English text itself, so a missing
 * entry never breaks a page. Placeholders: `t("{n} pieces", { n: 3 })`.
 *
 * Texts built elsewhere (domain errors, success messages, history summaries,
 * all written in English) are translated with `translateMessage`: dictionary
 * keys containing placeholders work as patterns, e.g.
 *   "{item} packed into {set}" -> "{item} in {set} gepackt".
 */
export const LOCALES = ["en", "de"] as const;
export type Locale = (typeof LOCALES)[number];
export type Dict = Record<string, string>;
export type Params = Record<string, string | number>;

export const LOCALE_LABEL: Record<Locale, string> = { en: "English", de: "Deutsch" };
/** BCP 47 tags for Intl date/number formatting. */
export const INTL_LOCALE: Record<Locale, string> = { en: "en-GB", de: "de-DE" };

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);

function fill(text: string, params?: Params) {
  return params ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : text;
}

export function translate(dict: Dict | null, text: string, params?: Params) {
  return fill((dict && dict[text]) ?? text, params);
}

type Pattern = { re: RegExp; names: string[]; to: string };
const compiled = new WeakMap<Dict, Pattern[]>();

/** Dictionary keys with placeholders as regular expressions. */
function patterns(dict: Dict): Pattern[] {
  let list = compiled.get(dict);
  if (list) return list;
  list = Object.entries(dict)
    .filter(([k]) => /\{\w+\}/.test(k))
    // Wrappers around another message ("Undo: {msg}") first, then the most literal text.
    .sort(([a], [b]) => Number(b.includes("{msg}")) - Number(a.includes("{msg}")) || b.replace(/\{\w+\}/g, "").length - a.replace(/\{\w+\}/g, "").length)
    .map(([k, to]) => {
      const names: string[] = [];
      const src = k
        .split(/(\{\w+\})/)
        .map((part) => {
          const m = part.match(/^\{(\w+)\}$/);
          if (m) {
            names.push(m[1]!);
            return "([\\s\\S]+?)";
          }
          return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("");
      return { re: new RegExp(`^${src}$`), names, to };
    });
  compiled.set(dict, list);
  return list;
}

/**
 * Translate a finished English message (exact entry first, then patterns);
 * unknown messages stay English. A placeholder named {msg} is itself a
 * message and translated too: "Undo: {msg}" -> "Rückgängig: {msg}".
 */
export function translateMessage(dict: Dict | null, msg: string | null | undefined): string {
  if (!msg || !dict) return msg ?? "";
  if (dict[msg]) return dict[msg]!;
  for (const p of patterns(dict)) {
    const m = msg.match(p.re);
    if (m) return fill(p.to, Object.fromEntries(p.names.map((n, i) => [n, n === "msg" ? translateMessage(dict, m[i + 1]!) : m[i + 1]!])));
  }
  return msg;
}

export type T = (text: string, params?: Params) => string;
export const makeT = (dict: Dict | null): T => (text, params) => translate(dict, text, params);
