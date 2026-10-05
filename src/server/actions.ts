import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { DomainError } from "./domain/context";

export type ActionState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  message?: string;
  /** Echo of submitted values so forms keep input after a failed submit. */
  values?: Record<string, string>;
  details?: Record<string, unknown>;
} | null;

export function formValues(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$")) out[k] = v;
  return out;
}

/**
 * Run a server-action body and turn known errors into form state.
 * Redirects / notFound thrown inside `fn` are re-thrown for Next.js to handle.
 */
export async function runAction(fd: FormData | null, fn: () => Promise<string | void>): Promise<ActionState> {
  try {
    const message = await fn();
    return { ok: true, message: message ?? undefined };
  } catch (err) {
    unstable_rethrow(err);
    const values = fd ? formValues(fd) : undefined;
    if (err instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of err.issues) {
        const key = issue.path.join(".") || "_";
        fieldErrors[key] ??= issue.message;
      }
      return { ok: false, error: "Please check the highlighted fields.", fieldErrors, values };
    }
    if (err instanceof DomainError) {
      return { ok: false, error: err.message, values, details: err.details };
    }
    console.error(err);
    return { ok: false, error: "Something went wrong. Please try again.", values };
  }
}

/** Raw form fields; domain services validate them with zod. */
export function fromForm(fd: FormData): never {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$")) out[k] = v;
  return out as never;
}
