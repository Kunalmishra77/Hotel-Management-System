/**
 * Review-link token (#26) — a compact, tamper-resistant token that ties a public
 * feedback link to a specific stay (so the Feedback row gets the right guest) WITHOUT
 * exposing the raw reservation id or needing a session. Not a secret credential; it's
 * unguessable (HMAC-signed) so a stay can't be enumerated.
 *
 * Server-only (imports node crypto) — never import from a client component.
 */
import { keyedHash, safeEqual } from "@/lib/crypto/encryption";

function sig(reservationId: string): string {
  return keyedHash(`review:${reservationId}`).slice(0, 24);
}

export function signReviewToken(reservationId: string): string {
  const b64 = Buffer.from(reservationId).toString("base64url");
  return `${b64}.${sig(reservationId)}`;
}

/** Returns the reservation id if the token is valid & untampered, else null. */
export function verifyReviewToken(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const b64 = token.slice(0, dot);
  const given = token.slice(dot + 1);
  let reservationId: string;
  try {
    reservationId = Buffer.from(b64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!reservationId || !safeEqual(given, sig(reservationId))) return null;
  return reservationId;
}

/** Absolute URL a stay's feedback QR encodes. */
export function reviewUrl(reservationId: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/review/${signReviewToken(reservationId)}`;
}
