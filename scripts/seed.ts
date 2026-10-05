import "dotenv/config";
import { sql } from "drizzle-orm";
import { createDb } from "../src/server/db/client";
import { workspace } from "../src/server/db/schema";
import { seedDemo } from "../src/server/db/seed/demo";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const { db, client } = createDb(url, { max: 1 });
try {
  const [{ count }] = (await db.select({ count: sql<number>`count(*)::int` }).from(workspace)) as [{ count: number }];
  if (count > 0) {
    console.log("Database already contains data; run `npm run db:reset` for a fresh demo database.");
  } else {
    const r = await seedDemo(db);
    console.log(`Seeded demo workspace ${r.workspaceId} with ${Object.keys(r.projectIds).length} projects.`);
  }
} finally {
  await client.end();
}
