import "server-only";
import { z } from "zod";

/**
 * Server environment, validated once at boot. Secrets live only here — nothing
 * in this module is ever imported by client components ("server-only" guard).
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url().default("postgres://postgres:postgres@localhost:5432/aisle"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  BETTER_AUTH_SECRET: z.string().min(16).default("dev-only-insecure-secret-change-me-please"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),

  /** "demo" | "keepa" | "creators". Demo is used automatically when no credentials exist. */
  DATA_PROVIDER: z.enum(["auto", "demo", "keepa", "creators"]).default("auto"),
  KEEPA_API_KEY: z.string().optional(),
  KEEPA_MONTHLY_TOKEN_BUDGET: z.coerce.number().int().positive().optional(),
  KEEPA_TOKEN_COST_USD: z.coerce.number().nonnegative().optional(),
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
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  FX_API_URL: z.string().url().optional(),
  DEMO_ACCOUNT_ENABLED: z.enum(["true", "false"]).default("true"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
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
