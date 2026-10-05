import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client";

export const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, "../../../drizzle");

export async function runMigrations(url: string) {
  const { db, client } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end();
  }
}
