import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { getCtx } from "./auth/context";
import { getDb } from "./db/client";
import { CURRENT_PROJECT_COOKIE, resolveCurrentProject } from "./domain/current-project";

/** Current project for this request (cookie + automatic choice), cached per request. */
export const getCurrentProject = cache(async () => {
  const ctx = await getCtx();
  const value = (await cookies()).get(CURRENT_PROJECT_COOKIE)?.value;
  return resolveCurrentProject(getDb(), ctx, value);
});
