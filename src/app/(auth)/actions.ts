"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runAction, type ActionState } from "@/server/actions";
import { auth } from "@/server/auth/auth";
import { getSessionUser, userHasWorkspace } from "@/server/auth/context";
import { getDb } from "@/server/db/client";
import { DomainError } from "@/server/domain/context";
import { createWorkspace } from "@/server/domain/workspaces";

const loginInput = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Required"),
});

function authError(err: unknown, fallback: string): never {
  if (err instanceof APIError) throw new DomainError("VALIDATION", err.body?.message ?? fallback);
  throw err;
}

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const data = loginInput.parse(Object.fromEntries(fd));
    try {
      await auth.api.signInEmail({ body: data, headers: await headers() });
    } catch (err) {
      authError(err, "Invalid email or password.");
    }
    const next = String(fd.get("next") ?? "");
    redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
  });
}

const signupInput = z.object({
  name: z.string().trim().min(1, "Required").max(120),
  email: z.email("Enter a valid email address"),
  password: z.string().min(8, "At least 8 characters").max(128),
});

export async function signupAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    if (process.env.ALLOW_SIGNUP === "false") {
      throw new DomainError("FORBIDDEN", "Sign-up is disabled on this server. Ask an admin for an account.");
    }
    const data = signupInput.parse(Object.fromEntries(fd));
    try {
      await auth.api.signUpEmail({ body: data, headers: await headers() });
    } catch (err) {
      authError(err, "Could not create the account.");
    }
    redirect("/onboarding");
  });
}

export async function createWorkspaceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const current = await getSessionUser();
    if (!current) redirect("/login");
    if (await userHasWorkspace(current.user.id)) redirect("/");
    await createWorkspace(getDb(), current.user.id, { name: String(fd.get("name") ?? "") });
    redirect("/");
  });
}

export async function signOutAction() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}
