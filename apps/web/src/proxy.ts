import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Route guard (Next.js "proxy", formerly middleware). It only checks that a
 * session cookie exists — a fast, optimistic gate. The API re-validates the
 * session on every request, so a forged cookie gets nothing.
 */
const PUBLIC_PREFIXES = ["/sign-in", "/sign-up", "/i/", "/p/", "/r/", "/b/", "/w/", "/f/", "/u/", "/c/", "/m/", "/o/", "/q/", "/pay/", "/h/", "/s/", "/sim/", "/privacy", "/terms", "/robots.txt", "/sitemap.xml"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = Boolean(getSessionCookie(request, { cookiePrefix: "leadanchor" }));
  // "/" is the marketing page for visitors; signed-in owners go on to their dashboard below.
  const isPublic = pathname === "/" || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (!hasSession && !isPublic) {
    const url = new URL("/sign-in", request.url);
    if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  if (hasSession && (pathname === "/sign-in" || pathname === "/sign-up")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (pathname === "/" && hasSession) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg|sw.js|widget.js|widget-demo.html|manifest.webmanifest|.*\\.(?:png|jpg|svg|webp|ico)$).*)"],
};
