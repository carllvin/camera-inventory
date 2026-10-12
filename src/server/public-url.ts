import "server-only";
import { headers } from "next/headers";

/** The address people reach the app at (PUBLIC_URL / BETTER_AUTH_URL), else this request's host. */
export async function publicBaseUrl() {
  const env = process.env.BETTER_AUTH_URL || process.env.PUBLIC_URL;
  if (env) return env.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
