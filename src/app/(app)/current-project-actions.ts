"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ALL_PROJECTS, CURRENT_PROJECT_COOKIE } from "@/server/domain/current-project";
import { UUID_RE } from "@/server/pages";

export async function setCurrentProjectAction(value: string) {
  const v = value === ALL_PROJECTS || UUID_RE.test(value) ? value : ALL_PROJECTS;
  (await cookies()).set(CURRENT_PROJECT_COOKIE, v, { path: "/", sameSite: "lax", httpOnly: true, maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}
