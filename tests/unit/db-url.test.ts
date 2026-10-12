import { describe, expect, it } from "vitest";
import { driverUrl, isTransactionPooler } from "@/server/db/url";

describe("driverUrl", () => {
  it("strips libpq-only parameters from hosted Postgres URLs but keeps sslmode", () => {
    const neon = "postgresql://u:p@ep-cool-name-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
    expect(driverUrl(neon)).toBe("postgresql://u:p@ep-cool-name-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require");
    expect(driverUrl("postgres://u:p@h:6543/db?pgbouncer=true&connection_limit=1")).toBe("postgres://u:p@h:6543/db");
    expect(driverUrl("postgres://postgres:postgres@localhost:5432/aisle")).toBe("postgres://postgres:postgres@localhost:5432/aisle");
  });
  it("detects transaction-mode poolers", () => {
    expect(isTransactionPooler("postgresql://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/db")).toBe(true);
    expect(isTransactionPooler("postgres://u:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres")).toBe(true);
    expect(isTransactionPooler("postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/db")).toBe(false);
  });
});
