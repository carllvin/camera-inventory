import "server-only";
import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { makeFormat } from "@/lib/format";
import { INTL_LOCALE, isLocale, makeT, translateMessage, type Locale } from "@/lib/i18n/core";
import { dictionaryFor } from "@/lib/i18n/dictionaries";
import { getSessionUser } from "./auth/context";
import { getDb } from "./db/client";
import * as s from "./db/schema";

export const LOCALE_COOKIE = "locale";

/**
 * The interface language for this request: the user's setting, else the
 * language cookie (signed out), else the browser's preference, else English.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  const current = await getSessionUser().catch(() => null);
  if (current) {
    const [u] = await getDb().select({ locale: s.user.locale }).from(s.user).where(eq(s.user.id, current.user.id));
    if (isLocale(u?.locale)) return u.locale;
  }
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  const accept = (await headers()).get("accept-language") ?? "";
  return /^\s*de\b/i.test(accept) ? "de" : "en";
});

/** `const t = await getT(); t("Save")` in server components and actions. */
export async function getT() {
  return makeT(dictionaryFor(await getLocale()));
}

/** Translate a finished English message (domain error, success text, history summary). */
export async function getTranslateMessage() {
  const dict = dictionaryFor(await getLocale());
  return (msg: string | null | undefined) => translateMessage(dict, msg);
}

export async function getIntlLocale() {
  return INTL_LOCALE[await getLocale()];
}

/** Date helpers in the user's language: `const f = await getFormat(); f.formatDate(d)`. */
export async function getFormat() {
  const locale = await getLocale();
  return makeFormat(INTL_LOCALE[locale], makeT(dictionaryFor(locale)));
}
