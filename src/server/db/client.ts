import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

declare global {
  var __aislePg: ReturnType<typeof postgres> | undefined;
}

/** One pool per process; reused across hot reloads in development. */
const client =
  globalThis.__aislePg ??
  postgres(env.DATABASE_URL, {
    max: env.NODE_ENV === "production" ? 10 : 5,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
if (env.NODE_ENV !== "production") globalThis.__aislePg = client;

export const db = drizzle(client, { schema, casing: "snake_case" });
export type DB = typeof db;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export { client as sqlClient };
