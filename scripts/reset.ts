/** Drop every Aisle table and re-run migrations. Development only. */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sqlClient } from "../src/server/db/client";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to reset a production database.");
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("✓ database reset");
  await sqlClient.end();
}
main().catch(async (e) => {
  console.error(e);
  await sqlClient.end().catch(() => {});
  process.exit(1);
});
