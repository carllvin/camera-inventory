"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fromForm, runAction, type ActionState } from "@/server/actions";
import { getCtx } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getT, LOCALE_COOKIE } from "@/server/i18n";
import { LOCALES } from "@/lib/i18n/core";
import { todayIso } from "@/lib/format";
import { DomainError } from "@/server/domain/context";
import { DEFAULT_NTFY_SERVER, getReminderSettings, saveReminderSettings } from "@/server/domain/reminders";
import { buildDigest } from "@/server/reminders/digest";
import { sendNtfy } from "@/server/reminders/ntfy";
import { publicBaseUrl } from "@/server/public-url";
import { createCategory, updateCategory } from "@/server/domain/categories";
import { createRentalHouse, updateRentalHouse } from "@/server/domain/rental-houses";
import { importStandardCatalog, importStandardRentalHouses } from "@/server/domain/standard-catalog";
import { addMember, changeMemberRole, renameWorkspace } from "@/server/domain/workspaces";

/** The interface language of the signed-in user ("" = follow the browser); also kept in a cookie for the sign-in pages. */
export async function setLanguageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getCtx();
    const raw = fd.get("locale");
    const locale = raw === "" ? null : z.enum(LOCALES).parse(raw);
    await getDb().update(s.user).set({ locale }).where(eq(s.user.id, ctx.userId));
    const jar = await cookies();
    if (locale) jar.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    else jar.delete(LOCALE_COOKIE);
    revalidatePath("/", "layout");
    // Already in the new language (the request still translates into the old one), so not in a dictionary.
    return locale === "de" ? "Sprache gespeichert." : "Language saved.";
  });
}

export async function renameWorkspaceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await renameWorkspace(getDb(), await getCtx(), fromForm(fd));
    revalidatePath("/", "layout");
    return "Workspace renamed.";
  });
}

export async function addMemberAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const u = await addMember(getDb(), await getCtx(), fromForm(fd));
    revalidatePath("/settings");
    return `${u.name} added.`;
  });
}

export async function changeRoleAction(userId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const role = z.enum(["owner", "admin", "member", "viewer"]).parse(fd.get("role"));
    await changeMemberRole(getDb(), await getCtx(), userId, role);
    revalidatePath("/settings");
    return "Role updated.";
  });
}

export async function createRentalHouseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const rh = await createRentalHouse(getDb(), await getCtx(), fromForm(fd));
    redirect(`/settings/rental-houses/${rh.id}`);
  });
}

export async function updateRentalHouseAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await updateRentalHouse(getDb(), await getCtx(), id, fromForm(fd));
    revalidatePath(`/settings/rental-houses/${id}`);
    return "Saved.";
  });
}

export async function createCategoryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const c = await createCategory(getDb(), await getCtx(), fromForm(fd));
    revalidatePath("/settings/categories");
    return `Category “${c.name}” added.`;
  });
}

export async function updateCategoryAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await updateCategory(getDb(), await getCtx(), id, fromForm(fd));
    revalidatePath("/settings/categories");
    return "Saved.";
  });
}

export async function importCatalogAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const sections = fd.getAll("sections").filter((v): v is string => typeof v === "string");
    const r = await importStandardCatalog(getDb(), await getCtx(), { sections });
    revalidatePath("/equipment", "layout");
    revalidatePath("/settings", "layout");
    return r.created === 0 && !r.corrected
      ? `Nothing new to add — all ${r.skipped} types of these areas are already in your catalog.`
      : `${r.created} equipment type${r.created === 1 ? "" : "s"} added${r.skipped ? ` (${r.skipped} already present, left unchanged)` : ""}${r.corrected ? `; ${r.corrected} corrected` : ""}.`;
  });
}

export async function importRentalHousesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const regions = fd.getAll("regions").filter((v): v is string => typeof v === "string");
    const r = await importStandardRentalHouses(getDb(), await getCtx(), { regions });
    revalidatePath("/settings", "layout");
    return r.created === 0
      ? `Nothing new to add — all ${r.skipped} rental houses of these regions are already in your list.`
      : `${r.created} rental house${r.created === 1 ? "" : "s"} added${r.skipped ? ` (${r.skipped} already present, left unchanged)` : ""}.`;
  });
}

/** The person's own reminders (ntfy). */
export async function saveRemindersAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getCtx();
    await saveReminderSettings(getDb(), ctx.userId, fromForm(fd));
    revalidatePath("/settings");
    return "Reminders saved.";
  });
}

/** Send today's summary now (or a short test message when nothing is due), without counting it as the daily one. */
export async function testReminderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getCtx();
    const db = getDb();
    const r = await getReminderSettings(db, ctx.userId);
    if (!r.ntfyTopic) throw new DomainError("VALIDATION", "Enter an ntfy topic first and save.");
    const [u] = await db.select({ token: s.user.ntfyToken }).from(s.user).where(eq(s.user.id, ctx.userId));
    const digest = await buildDigest(db, ctx.userId, todayIso());
    const base = await publicBaseUrl();
    const t = await getT();
    try {
      await sendNtfy(r.ntfyServer || DEFAULT_NTFY_SERVER, r.ntfyTopic, u?.token ?? null, digest
        ? { title: digest.title, message: digest.message, click: `${base}${digest.path}` }
        : { title: t("Camera Inventory"), message: t("Test: reminders work. Nothing is due in the next days."), click: `${base}/calendar` });
    } catch (err) {
      throw new DomainError("VALIDATION", `Could not send: ${err instanceof Error ? err.message : String(err)}`);
    }
    return digest ? "Summary sent." : "Test message sent.";
  });
}
