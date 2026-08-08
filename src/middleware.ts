/**
 * Auth gate — 00 T-20 (FR-26, AC-24).
 *
 * "The app shell gates every `(dashboard)` route behind authentication."
 *
 * IMPORTANT — what this is and is not.
 * This runs on the Edge runtime, where Prisma cannot run, so it can only see
 * whether a session COOKIE is present. That is a redirect for user experience,
 * NOT authorization. Real enforcement happens server-side on every request:
 * `requireSession()` resolves the token against the database and re-checks
 * `revokedAt` (security.md), and `authorize()` gates every mutation.
 *
 * Consequence worth stating plainly: a user holding a revoked-but-unexpired
 * cookie passes this middleware and is then rejected by the page/action. That
 * is the correct split — never move an authorization decision up here just
 * because it would be faster.
 */
import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth/auth.config";

const { auth } = NextAuth(authConfig);

/** Routes reachable without a session. Everything else requires one. */
const PUBLIC_PREFIXES = [
  "/", // public landing/overview (exact match only — see isPublic)
  "/sign-in",
  "/two-factor",
  "/forgot-password",
  "/reset-password",
  "/api/auth", // Auth.js endpoints
  "/api/health", // liveness probe (observability.md)
  "/api/webhooks", // provider webhooks — signature-verified, not session-authed
  "/api/booking-engine", // public booking engine (23)
  "/book", // public booking website UI (23) — unauthenticated by design
  "/order", // public in-room QR ordering (19 addendum) — token-gated, no session
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default auth((req) => {
  const { pathname, search } = req.nextUrl;

  if (isPublic(pathname)) {
    /**
     * Deliberately does NOT bounce a "signed-in" caller away from /sign-in.
     *
     * `req.auth` only proves a JWT cookie is present — it says nothing about
     * whether the DB session behind it is still live. Redirecting on that
     * signal produced an infinite loop when a session was revoked but its
     * cookie had not yet expired:
     *   /properties → (layout: real session is null) → /sign-in
     *   /sign-in    → (middleware: cookie present!)  → /dashboard
     *   /dashboard  → (layout: real session is null) → /sign-in  → …
     *
     * The convenience redirect now lives on the sign-in page itself, which
     * resolves the real session server-side and can therefore tell the
     * difference. Authority is the database, never the cookie.
     */
    return NextResponse.next();
  }

  if (!req.auth) {
    const signIn = new URL("/sign-in", req.nextUrl);
    // Preserve where they were going so sign-in can return them there.
    if (pathname !== "/") signIn.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(signIn);
  }

  return NextResponse.next();
});

export const config = {
  /**
   * Skip static assets and image optimisation — running auth on every icon
   * request wastes latency on the mobile networks the NFRs budget for.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|offline.html|icons/|.*\\.png$).*)",
  ],
};
