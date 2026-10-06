/**
 * Container start, in one process (no extra one-shot containers):
 *  1. make the storage volume writable for the app user (volumes and bind
 *     mounts are often created owned by root),
 *  2. apply pending database migrations (advisory lock: safe with several
 *     app containers, retried while Postgres is still starting),
 *  3. drop root privileges and start the Next.js server.
 */
import { chownSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const APP_UID = 1001;
const APP_GID = 1001;
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
const log = (msg) => console.log(`[start] ${msg}`);

function fixOwnership(dir) {
  mkdirSync(dir, { recursive: true });
  let changed = 0;
  const walk = (p) => {
    const st = lstatSync(p);
    if (st.uid !== APP_UID || st.gid !== APP_GID) {
      chownSync(p, APP_UID, APP_GID);
      changed++;
    }
    if (st.isDirectory()) for (const name of readdirSync(p)) walk(join(p, name));
  };
  walk(dir);
  if (changed) log(`storage: ownership fixed on ${changed} file(s)`);
}

async function runMigrations(url) {
  for (let attempt = 1; ; attempt++) {
    const sql = postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 10 });
    try {
      await sql`SELECT pg_advisory_lock(727274)`;
      try {
        await migrate(drizzle(sql), { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
      } finally {
        await sql`SELECT pg_advisory_unlock(727274)`;
      }
      await sql.end();
      log("database: migrations up to date");
      return;
    } catch (err) {
      await sql.end({ timeout: 1 }).catch(() => {});
      const transient = ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "57P03"].includes(err?.code);
      if (!transient || attempt >= 30) throw err;
      log(`database not reachable yet (${err.code}), retrying …`);
      await sleep(2000);
    }
  }
}

const storageDir = process.env.STORAGE_DRIVER === "s3" ? null : (process.env.STORAGE_LOCAL_DIR ?? "/app/storage");
if (storageDir) {
  if (isRoot) fixOwnership(storageDir);
  else log("not started as root: skipping the storage ownership check");
}

if (!process.env.DATABASE_URL) {
  console.error("[start] DATABASE_URL is not set");
  process.exit(1);
}
await runMigrations(process.env.DATABASE_URL);

if (isRoot) {
  process.setgroups([APP_GID]);
  process.setgid(APP_GID);
  process.setuid(APP_UID);
}
process.env.HOME = "/app";
await import(new URL("../server.js", import.meta.url).href);
