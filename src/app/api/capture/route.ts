import { NextResponse, type NextRequest } from "next/server";
import { captureSchema, recordCapture } from "@/server/capture/service";
import { verifyCaptureToken } from "@/server/capture/tokens";
import { HttpError } from "@/server/errors";
import { assertSameOrigin, errorResponse, rateLimit } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

/**
 * POST /api/capture — a price the owner captured from an Amazon.in product page.
 *
 * Two ways in:
 *  - the bookmarklet, cross-origin from amazon.in, with `Authorization: Bearer <capture token>`.
 *    No cookies are read on this path, so it can't be used for CSRF;
 *  - Aisle's own /capture/receive window (the fallback when a page's security policy
 *    blocks the request), same-origin with the signed-in session.
 */
const AMAZON_IN_ORIGIN = /^https:\/\/([a-z0-9-]+\.)?amazon\.in$/i;
const MAX_BODY_BYTES = 16 * 1024;

function cors(req: NextRequest, res: NextResponse) {
  const origin = req.headers.get("origin");
  if (origin && AMAZON_IN_ORIGIN.test(origin)) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.headers.set("Access-Control-Max-Age", "600");
  }
  res.headers.set("Vary", "Origin");
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export function OPTIONS(req: NextRequest) {
  return cors(req, new NextResponse(null, { status: 204 }));
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  try {
    const auth = req.headers.get("authorization");
    let ctx;
    let key: string;
    if (auth?.toLowerCase().startsWith("bearer ")) {
      const v = await verifyCaptureToken(auth.slice(7).trim());
      ctx = v.ctx;
      key = `capture:${v.tokenId}`;
    } else {
      assertSameOrigin(req); // session path: only from Aisle itself
      ctx = await requireApiContext("analyst");
      key = `capture:user:${ctx.user.id}`;
    }
    rateLimit(key, 30, 60_000);
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) throw new HttpError(413, "Capture is too large.", "too_large");
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new HttpError(400, "Request body must be JSON.", "invalid_json");
    }
    const input = captureSchema.parse(body);
    const result = await recordCapture(ctx, input);
    if (result.status === "untracked") return cors(req, NextResponse.json({ error: "untracked_asin", asin: result.asin, importUrl: result.importUrl }, { status: 404 }));
    return cors(req, NextResponse.json({ capture: { ...result, duplicate: result.status === "duplicate" } }));
  } catch (e) {
    return cors(req, errorResponse(e, req, started));
  }
}
