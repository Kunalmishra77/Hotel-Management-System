/**
 * Public guest website switch (client decision, 12 Nov 2026).
 *
 * The client runs Woodpecker PMS as a CRM only for now: the marketing home page,
 * the direct-booking site (module 23), the guest account area and the /portal
 * launcher are switched OFF. The code stays so the website can come back later
 * as a config change (`PUBLIC_WEBSITE_ENABLED=true`), never a rebuild.
 *
 * Still public while the website is off, because the CRM itself uses them:
 * sign-in / password reset, in-room QR ordering (/order), guest feedback
 * links (/review), the driver tracker (/track), webhooks and the health check.
 */
export const WEBSITE_PREFIXES = [
  "/portal",
  "/account",
  "/book",
  "/product",
  "/start",
  "/api/booking-engine",
] as const;

export function isPublicWebsiteEnabled(): boolean {
  return process.env.PUBLIC_WEBSITE_ENABLED === "true";
}

/** True for a path that belongs to the public guest website ("/" counts). */
export function isWebsitePath(pathname: string): boolean {
  if (pathname === "/") return true;
  return WEBSITE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
