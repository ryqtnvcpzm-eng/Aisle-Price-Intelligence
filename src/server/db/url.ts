/**
 * Hosted Postgres providers hand out libpq-style URLs. postgres.js forwards any
 * query parameter it doesn't recognise to the server as a startup setting, so
 * libpq-only flags (Neon's `channel_binding=require`, Prisma's `pgbouncer=true`)
 * fail every connection with "unrecognized configuration parameter". Strip them.
 */
const LIBPQ_ONLY = ["channel_binding", "pgbouncer", "gssencmode", "connection_limit", "pool_timeout"];

export function driverUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  for (const key of LIBPQ_ONLY) url.searchParams.delete(key);
  return url.toString();
}

/** Transaction-mode poolers (Neon "-pooler" hosts, Supabase :6543, PgBouncer) can't keep named prepared statements. */
export function isTransactionPooler(raw: string): boolean {
  return /-pooler\.|pooler\.supabase\.com|:6543\/|pgbouncer=true/i.test(raw);
}
