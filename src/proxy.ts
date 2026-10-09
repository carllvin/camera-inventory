import { NextResponse, type NextRequest } from "next/server";

/**
 * Cheap pre-check: requests without a session cookie go to /login.
 * The real session validation happens server-side in getCtx().
 */
export function proxy(req: NextRequest) {
  const hasSession = req.cookies.getAll().some((c) => c.name.endsWith("better-auth.session_token"));
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = req.nextUrl.pathname === "/" ? "" : `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/|_next/|login|signup|favicon.ico|icon|apple-icon|manifest.webmanifest|.*\\.(?:png|jpg|svg|ico|webmanifest)$).*)"],
};
