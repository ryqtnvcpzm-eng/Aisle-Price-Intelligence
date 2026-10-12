import pino from "pino";

/** Structured logs. Secrets are redacted by key name wherever they appear. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: process.env.AISLE_SERVICE ?? "web" },
  redact: {
    paths: [
      "key",
      "*.key",
      "apiKey",
      "*.apiKey",
      "password",
      "*.password",
      "authorization",
      "*.authorization",
      "headers.authorization",
      "headers.cookie",
      "secret",
      "*.secret",
      "token",
      "*.token",
      "credentialSecret",
      "*.credentialSecret",
    ],
    censor: "[redacted]",
  },
});

/** Strip query strings that may carry API keys (Keepa uses ?key=) from URLs before logging. */
export function safeUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of ["key", "api_key", "apikey", "token"]) if (u.searchParams.has(k)) u.searchParams.set(k, "[redacted]");
    return u.toString();
  } catch {
    return "[unparseable url]";
  }
}
