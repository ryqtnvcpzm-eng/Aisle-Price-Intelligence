/** Apply SQL migrations from ./drizzle. Safe to run repeatedly (tracked in drizzle.__drizzle_migrations). */
import "dotenv/config";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sqlClient } from "../src/server/db/client";

async function main() {
  const started = Date.now();
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log(`✓ migrations applied in ${Date.now() - started}ms`);
  await sqlClient.end();
}

main().catch(async (e) => {
  console.error("✗ migration failed:", e);
  await sqlClient.end().catch(() => {});
  process.exit(1);
});
