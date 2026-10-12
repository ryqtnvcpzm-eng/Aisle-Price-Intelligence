import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Fast unauthenticated redirect at the edge of routing. This is a UX
 * optimisation only — every page and API route still validates the session
 * server-side (see server/workspace/context.ts).
 */
export function proxy(req: NextRequest) {
  if (!getSessionCookie(req)) {
    const url = req.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next|sign-in|sign-up|demo-images|icon.svg|favicon.ico|robots.txt).*)"],
};
