import "server-only";
import { notFound } from "next/navigation";
import { DomainError, pgErrorOf } from "./domain/context";

/** Turn "not found" (or a malformed id in the URL) into Next's 404 page. */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof DomainError && err.code === "NOT_FOUND") notFound();
    if (pgErrorOf(err)?.code === "22P02") notFound(); // invalid uuid syntax
    throw err;
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function assertUuid(id: string) {
  if (!UUID_RE.test(id)) notFound();
}
