/**
 * Booking-engine internals. NOT a "use server" module.
 *
 * The public booking flow is UNAUTHENTICATED but system-driven: like 03's
 * `createFromChannel` and 06's `handlePaymentWebhook`, it runs on the UNSCOPED
 * client inside `runWithSystemContext(orgId)` so `emitEvent`/`writeAudit` still
 * carry an actor (the "web" device), while every anti-overbooking guarantee comes
 * from the DB — the `room_no_overlap` exclusion constraint on `RoomAllocation`,
 * exactly as 03's booking transaction relies on it.
 *
 * Holds here: the per-IP+route rate limiter, bot/abuse detection, the HMAC-signed
 * self-service token, the safe 24-dynamic-pricing wrapper (base-rate fallback),
 * and the guest upsert (04 duplicate-detection on mobile/email).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { runWithSystemContext } from "@/lib/context";
import { encryptOptional, encryptString, keyedHash } from "@/lib/crypto/encryption";
import { logger } from "@/lib/logger";
import type { PrismaClient } from "@prisma/client";

/** The unscoped client — the public flow has no user; tenancy is enforced by
 *  resolving everything from the property's own `orgId` + explicit propertyId. */
export function bookingDb(): PrismaClient {
  return db.unscoped();
}

export function withBookingSystemContext<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  return runWithSystemContext(orgId, fn);
}

// ---------------------------------------------------------------------------
// Rate limiting (FR-10) — per IP + route, fixed-window counter.
// In-process by design: tech-stack.md forbids Redis without an ADR, and a single
// app instance's memory is sufficient for the front-desk-scale traffic here. A
// horizontally-scaled deployment would swap this for a shared store behind the
// same `checkRateLimit` interface (documented as a scale delta).
// ---------------------------------------------------------------------------

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export type RateLimitRule = { limit: number; windowMs: number };

export const RATE_LIMITS = {
  availability: { limit: 60, windowMs: 60_000 },
  hold: { limit: 10, windowMs: 60_000 },
  booking: { limit: 30, windowMs: 60_000 },
} satisfies Record<string, RateLimitRule>;

export type RateLimitRoute = keyof typeof RATE_LIMITS;

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSec: number };

/** Consume one token for (route, ip). Returns retry-after seconds when blocked. */
export function checkRateLimit(
  route: RateLimitRoute,
  ip: string,
  now: number = Date.now(),
): RateLimitResult {
  const rule = RATE_LIMITS[route];
  const key = `${route}:${ip}`;
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return { ok: true };
  }
  if (existing.count >= rule.limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
  }
  existing.count += 1;
  return { ok: true };
}

/** Test seam — clear the counters between cases. */
export function resetRateLimits(): void {
  buckets.clear();
}

/** Best-effort client IP from the standard proxy headers. */
export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "0.0.0.0";
}

// ---------------------------------------------------------------------------
// Bot / abuse detection (FR-11) — cheap heuristics run BEFORE any hold/order.
// ---------------------------------------------------------------------------

export type BotSignalInput = {
  honeypot?: string;
  captchaToken?: string;
};

/** True ⇒ reject as a bot. A filled honeypot is a definite bot; a missing
 *  captcha is rejected only when captcha is enforced by env config. */
export function isBotRequest(input: BotSignalInput): boolean {
  if (input.honeypot != null && input.honeypot.trim() !== "") return true;
  if (captchaRequired() && !input.captchaToken) return true;
  return false;
}

function captchaRequired(): boolean {
  return process.env.BOOKING_ENGINE_CAPTCHA === "required";
}

// ---------------------------------------------------------------------------
// Signed self-service token (FR-16/20) — no login; the signature is the proof.
// ---------------------------------------------------------------------------

function tokenSecret(): string {
  // `||` so an empty env value still falls back — never sign with "".
  return process.env.BOOKING_ENGINE_TOKEN_SECRET || process.env.PAYMENTS_WEBHOOK_SECRET || "sandbox-booking-token-secret";
}

/** `<payloadB64url>.<hmac>` binding an order + reservation with an expiry. */
export function signBookingToken(payload: { orderId: string; reservationId: string; exp: number }): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", tokenSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export type BookingTokenPayload = { orderId: string; reservationId: string; exp: number };

/** Verify + decode a signed token; null on tamper or expiry. */
export function verifyBookingToken(token: string, now: number = Date.now()): BookingTokenPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", tokenSecret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as BookingTokenPayload;
    if (typeof payload.exp !== "number" || payload.exp <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 24-dynamic-pricing wrapper (FR-3/18) — never let a missing rate fail search.
// ---------------------------------------------------------------------------

/**
 * Resolve the sellable nightly rate for a category on a date.
 *
 * DEPENDENCY ON 24: the contract is
 *   getResolvedRate(user, { propertyId, roomCategoryId, date }): { ratePaise, source }
 * (module 24 is built concurrently — the parent reconciles at merge). We import
 * it dynamically inside a try/catch so that, until 24 is wired, a missing module
 * or a thrown error falls back to the category base tariff — search NEVER fails
 * for a missing dynamic rate (FR-18, AC-3). Public/anonymous bookings pass no
 * negotiated rate.
 */
export async function safeResolvedRate(input: {
  orgId: string;
  propertyId: string;
  roomCategoryId: string;
  date: Date;
  baseRatePaise: number;
}): Promise<{ ratePaise: number; source: string }> {
  try {
    const mod = (await import("@/features/dynamic-pricing/queries")) as {
      getResolvedRate?: (
        user: unknown,
        args: { propertyId: string; roomCategoryId: string; date: Date; negotiatedRatePaise?: number },
      ) => Promise<{ ratePaise: number; source: string }>;
    };
    if (typeof mod.getResolvedRate === "function") {
      const systemActor = {
        userId: "system",
        orgId: input.orgId,
        propertyScope: { kind: "ALL_IN_ORG" as const },
        accessiblePropertyIds: [input.propertyId],
        activePropertyId: input.propertyId,
        resolvedPermissions: [],
        roleAssignments: [],
      };
      const res = await mod.getResolvedRate(systemActor, {
        propertyId: input.propertyId,
        roomCategoryId: input.roomCategoryId,
        date: input.date,
      });
      if (res && Number.isFinite(res.ratePaise) && res.ratePaise > 0) return res;
    }
  } catch (e) {
    logger.info("booking-engine.resolved_rate_fallback", {
      roomCategoryId: input.roomCategoryId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return { ratePaise: input.baseRatePaise, source: "base" };
}

// ---------------------------------------------------------------------------
// Guest upsert (FR-4) — duplicate detection on mobile/email (business-rules §16).
// Guests are org-scoped (04 owns them); the public flow creates or reuses one.
// Contact is stored ENCRYPTED with keyed `*Hash` search tokens, exactly as 04
// writes them (src/features/guests/internal.ts contactColumns).
// ---------------------------------------------------------------------------

function normalizeMobile(mobile: string): string {
  return mobile.replace(/[\s-]/g, "").trim();
}

export async function upsertPublicGuest(
  tx: { guest: PrismaClient["guest"] },
  input: { orgId: string; fullName: string; mobile: string; email?: string; city?: string; state?: string },
): Promise<{ id: string }> {
  const mobileHash = keyedHash(normalizeMobile(input.mobile).toLowerCase());
  const emailHash = input.email ? keyedHash(input.email.trim().toLowerCase()) : null;

  // Dedupe on either contact token (business-rules §16): reuse the live guest.
  const existing = await tx.guest.findFirst({
    where: {
      orgId: input.orgId,
      deletedAt: null,
      OR: [
        { mobileHash },
        ...(emailHash ? [{ emailHash }] : []),
      ],
    },
    select: { id: true },
  });
  if (existing) return existing;

  return tx.guest.create({
    data: {
      orgId: input.orgId,
      fullName: input.fullName,
      mobile: encryptString(normalizeMobile(input.mobile)),
      mobileHash,
      email: encryptOptional(input.email ?? null),
      emailHash,
      city: input.city ?? null,
      state: input.state ?? null,
    },
    select: { id: true },
  });
}
