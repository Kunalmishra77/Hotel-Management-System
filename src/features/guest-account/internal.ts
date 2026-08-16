/**
 * Internal helpers for guest-account actions (Phase 2). Not part of the module's
 * public surface — actions.ts is. Kept here so actions stay small.
 */
import type { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { NotFoundError } from "@/lib/errors";
import { encryptString, encryptOptional } from "@/lib/crypto/encryption";
import { resolveMessagingProvider } from "@/lib/messaging";
import { normalizeMobile, mobileHashOf, emailHashOf } from "@/lib/guest-auth";

/**
 * A bcrypt hash of a throwaway value — equalises login timing when no account
 * exists for an email, so a fast "no such account" can't be told from a slow
 * real compare (same anti-enumeration rule as staff `credentials.ts`).
 */
export const TIMING_EQUALISER_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEe.WQ1cJPUuTZUJ4L2Xn5qkOaBcQ6dGZ0K";

/**
 * The name a brand-new phone-only signup gets when no name was captured and no
 * existing guest matched. The account area treats it as "no real name yet" and
 * asks the guest to complete their profile. Kept as one constant so the default
 * and the "needs profile" check can never drift apart.
 */
export const PLACEHOLDER_GUEST_NAME = "Guest";

/**
 * The org that owns the public customer surface. Single operator for now (one
 * Organization), resolved from any active property. When the customer site
 * becomes multi-tenant this is where an org-per-host lookup goes.
 */
export async function resolvePublicOrgId(): Promise<string> {
  const p = await db
    .unscoped()
    .property.findFirst({ where: { isActive: true, deletedAt: null }, select: { orgId: true } });
  if (!p) throw new NotFoundError("No active property is configured yet.");
  return p.orgId;
}

/**
 * Find-or-create the CRM `Guest` a new account links to, deduped by contact —
 * identical hashing to `upsertPublicGuest`, so a guest who booked before signing
 * up maps to their existing record (the hotel sees one guest). Returns the id.
 */
export async function findOrCreateGuestForAccount(
  tx: { guest: PrismaClient["guest"] },
  input: { orgId: string; fullName: string; mobile: string; email?: string | null },
): Promise<{ id: string; fullName: string }> {
  const mobileHash = mobileHashOf(input.mobile);
  const emailHash = input.email ? emailHashOf(input.email) : null;

  const existing = await tx.guest.findFirst({
    where: {
      orgId: input.orgId,
      deletedAt: null,
      OR: [{ mobileHash }, ...(emailHash ? [{ emailHash }] : [])],
    },
    select: { id: true, fullName: true },
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
    },
    select: { id: true, fullName: true },
  });
}

/**
 * Deliver an OTP over SMS, best-effort. Resolves the sandbox mock provider when
 * no live SMS account is wired (integrations.md) — the code lands in the outbox,
 * the app runs end-to-end with zero external accounts. A send failure is logged,
 * never thrown: the code is already stored, and dev returns it directly.
 */
export async function deliverOtpSms(toMobile: string, code: string): Promise<void> {
  try {
    const provider = resolveMessagingProvider({ channel: "SMS", provider: "mock", mode: "sandbox" });
    await provider.sendTemplate({
      channel: "SMS",
      toAddress: normalizeMobile(toMobile),
      body: `${code} is your Woodpecker verification code. It expires in 10 minutes. Do not share it.`,
      templateKey: "guest-otp",
    });
  } catch (e) {
    logger.warn("guest-otp.delivery-failed", { error: e instanceof Error ? e.message : String(e) });
  }
}

/** Dev-only convenience: surface the OTP so the demo works before SMS goes live. */
export function isNonProduction(): boolean {
  return process.env.NODE_ENV !== "production";
}
