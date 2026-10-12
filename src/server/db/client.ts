import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";
import { driverUrl, isTransactionPooler } from "./url";

declare global {
  var __aislePg: ReturnType<typeof postgres> | undefined;
}

/** Serverless hosts run many small instances; keep each one's footprint tiny. */
const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);

/** One pool per process; reused across hot reloads in development. */
const client =
  globalThis.__aislePg ??
  postgres(driverUrl(env.DATABASE_URL), {
    max: serverless ? 3 : env.NODE_ENV === "production" ? 10 : 5,
    prepare: !isTransactionPooler(env.DATABASE_URL),
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
if (env.NODE_ENV !== "production") globalThis.__aislePg = client;

export const db = drizzle(client, { schema, casing: "snake_case" });
export type DB = typeof db;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export { client as sqlClient };
