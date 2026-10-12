import "server-only";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { env } from "../env";
import { provisionWorkspaceForUser } from "../workspace/provision";
import { signupAllowed } from "./allowlist";

export const auth = betterAuth({
  appName: "Aisle",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  rateLimit: {
    enabled: env.NODE_ENV === "production",
    window: 60,
    max: 30,
  },
  advanced: {
    useSecureCookies: env.BETTER_AUTH_URL.startsWith("https://"),
  },
  databaseHooks: {
    user: {
      create: {
        before: async (candidate) => {
          if (!signupAllowed(candidate.email, env.SIGNUP_ALLOWLIST)) {
            throw new APIError("FORBIDDEN", { message: "Sign-ups are restricted on this Aisle deployment. Ask the owner to add your email." });
          }
          return { data: candidate };
        },
        after: async (created) => {
          await provisionWorkspaceForUser({ id: created.id, name: created.name, email: created.email });
        },
      },
    },
  },
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
