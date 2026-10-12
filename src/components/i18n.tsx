"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { makeFormat } from "@/lib/format";
import { INTL_LOCALE, makeT, makeTN, translateMessage, type Dict, type Locale } from "@/lib/i18n/core";

const I18nContext = createContext<{ locale: Locale; dict: Dict | null; names: Dict | null }>({ locale: "en", dict: null, names: null });

/** Gives client components the user's language (set once in the root layout). */
export function I18nProvider({ locale, dict, names, children }: { locale: Locale; dict: Dict | null; names: Dict | null; children: ReactNode }) {
  const value = useMemo(() => ({ locale, dict, names }), [locale, dict, names]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** `const t = useT(); t("Save")` in client components. */
export function useT() {
  const { dict } = useContext(I18nContext);
  return useMemo(() => makeT(dict), [dict]);
}

/** Translate finished messages (server action results, errors) in client components. */
export function useTranslateMessage() {
  const { dict } = useContext(I18nContext);
  return (msg: string | null | undefined) => translateMessage(dict, msg);
}

export function useLocale(): { locale: Locale; intl: string } {
  const { locale } = useContext(I18nContext);
  return { locale, intl: INTL_LOCALE[locale] };
}

/** Date helpers in the user's language. */
export function useFormat() {
  const { locale, dict } = useContext(I18nContext);
  return useMemo(() => makeFormat(INTL_LOCALE[locale], makeT(dict)), [locale, dict]);
}

/** Category / brandless equipment names in the user's language. */
export function useTN() {
  const { names } = useContext(I18nContext);
  return useMemo(() => makeTN(names), [names]);
}
