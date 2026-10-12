import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { logger } from "./logger";
import { HttpError } from "./errors";

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response | unknown>;

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Reject cross-site state-changing requests (CSRF defence in addition to SameSite cookies). */
function assertSameOrigin(req: NextRequest) {
  if (!MUTATING.has(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients (curl, tests) don't send Origin; auth cookie is still required.
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw new HttpError(403, "Cross-origin request rejected.", "csrf");
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(403, "Cross-origin request rejected.", "csrf");
  }
}

// Simple fixed-window limiter per key. Adequate for a single web instance; swap
// for Redis when scaling horizontally (see docs/ARCHITECTURE.md).
const windows = new Map<string, { start: number; count: number }>();
export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start > windowMs) {
    windows.set(key, { start: now, count: 1 });
    return;
  }
  w.count += 1;
  if (w.count > max) throw new HttpError(429, "You're going a little fast — try again in a moment.", "rate_limited");
}

export function handle<C = unknown>(fn: Handler<C>) {
  return async (req: NextRequest, ctx: C) => {
    const started = Date.now();
    try {
      assertSameOrigin(req);
      const result = await fn(req, ctx);
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) {
        return NextResponse.json({ error: { message: e.message, code: e.code ?? "error" } }, { status: e.status });
      }
      if (e instanceof ZodError) {
        return NextResponse.json(
          { error: { message: "Some fields need attention.", code: "invalid_input", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } },
          { status: 400 },
        );
      }
      logger.error({ err: e, path: req.nextUrl.pathname, method: req.method, ms: Date.now() - started }, "unhandled route error");
      return NextResponse.json({ error: { message: "Something went wrong on our side. It's been logged.", code: "internal" } }, { status: 500 });
    }
  };
}

export async function readJson<T>(req: NextRequest, parse: (v: unknown) => T): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON.", "invalid_json");
  }
  return parse(body);
}
