import "server-only";
import { z } from "zod";

/**
 * Server environment, validated once at boot. Secrets live only here — nothing
 * in this module is ever imported by client components ("server-only" guard).
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url().default("postgres://postgres:postgres@localhost:5432/aisle"),
  /** Optional. Without it, Aisle caches in Postgres and monitoring runs via `pnpm worker:once` on a schedule. */
  REDIS_URL: z.string().min(1).optional(),
  BETTER_AUTH_SECRET: z.string().min(16).default("dev-only-insecure-secret-change-me-please"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),

  /** "auto" | "demo" | "creators". Aisle only integrates free data sources; demo is used when no credentials exist. */
  DATA_PROVIDER: z.enum(["auto", "demo", "creators"]).default("auto"),
  CREATORS_API_CREDENTIAL_ID: z.string().optional(),
  CREATORS_API_CREDENTIAL_SECRET: z.string().optional(),
  CREATORS_API_CREDENTIAL_VERSION: z.string().optional(),
  CREATORS_API_PARTNER_TAG: z.string().optional(),
  /** Operator confirms their Associates agreement permits storing/monitoring prices. */
  CREATORS_API_LICENSE_ACK: z.enum(["true", "false"]).default("false"),

  MONITOR_DEFAULT_INTERVAL_MINUTES: z.coerce.number().int().min(15).default(60),
  MONITOR_MAX_ASINS_PER_TICK: z.coerce.number().int().positive().default(500),
  MONITOR_CONCURRENCY: z.coerce.number().int().positive().default(2),
  OBSERVATION_RETENTION_DAYS: z.coerce.number().int().positive().default(730),
  ALLOW_SHORT_LINK_RESOLUTION: z.enum(["true", "false"]).default("true"),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Aisle <alerts@example.com>"),
  /** "true" records every email as skipped instead of sending it (tests, previews, staging). */
  EMAIL_DRY_RUN: z.enum(["true", "false"]).default("false"),
  /** Optional, opt-in. The feature is hidden and nothing is called unless a key is set. */
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  /** Comma-separated emails and/or @domains allowed to sign up. Unset or "*" = open registration. */
  SIGNUP_ALLOWLIST: z.string().optional(),
  DEMO_ACCOUNT_ENABLED: z.enum(["true", "false"]).default("true"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  // Treat blank values (common in hosting dashboards and .env templates) as unset.
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === "production" && env.BETTER_AUTH_SECRET.startsWith("dev-only")) {
    throw new Error("BETTER_AUTH_SECRET must be set in production.");
  }
  return env;
}

export const env = load();
