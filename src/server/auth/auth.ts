import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "../db/client";
import { account, session, user, verification } from "../db/schema";

export const auth = betterAuth({
  appName: "Camera Inventory",
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  database: drizzleAdapter(getDb(), { provider: "pg", schema: { user, session, account, verification } }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days — crews stay logged in on their phones
    updateAge: 60 * 60 * 24,
  },
  advanced: {
    database: { generateId: "uuid" },
  },
  telemetry: { enabled: false },
  // nextCookies lets server actions set the session cookie.
  plugins: [nextCookies()],
});
