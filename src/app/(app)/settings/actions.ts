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
import { LOCALE_COOKIE } from "@/server/i18n";
import { LOCALES } from "@/lib/i18n/core";
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
