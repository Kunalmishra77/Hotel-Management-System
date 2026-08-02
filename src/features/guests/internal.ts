/**
 * Shared internals for the guest actions.
 *
 * NOT a "use server" module. Holds the encryption/token helpers, the scoped-db
 * accessor, and the PII-safe row shaping every guest action needs.
 */
import { db } from "@/lib/db";
import { newRequestId, runWithContext } from "@/lib/context";
import { encryptOptional, keyedHash } from "@/lib/crypto/encryption";
import { normalizeEmail, normalizePhone } from "./domain/normalize";
import type { SessionClaims } from "@/lib/auth/claims";

/** Guests carry `orgId`, not `propertyId` — org-scoped, not property-scoped. */
export function guestDb() {
  return db.unscoped();
}

export function withGuestContext<T>(user: SessionClaims, fn: () => Promise<T>): Promise<T> {
  return runWithContext(
    {
      orgId: user.orgId,
      userId: user.userId,
      propertyScope: user.propertyScope,
      activePropertyId: user.activePropertyId,
      requestId: newRequestId(),
      ip: null,
      device: null,
    },
    fn,
  );
}

/**
 * Keyed search token for a mobile — the value stored in `Guest.mobileHash`.
 * Normalise first so every written form of a number hashes identically, and
 * so a dedupe lookup finds the guest regardless of how the number was typed.
 */
export function mobileToken(mobile: string | null | undefined): string | null {
  const normalized = normalizePhone(mobile);
  return normalized ? keyedHash(normalized) : null;
}

export function emailToken(email: string | null | undefined): string | null {
  const normalized = normalizeEmail(email);
  return normalized ? keyedHash(normalized) : null;
}

/**
 * Build the encrypted + tokenised contact columns for a Guest write.
 *
 * Contact fields are stored ENCRYPTED (`data-model.md`); the `*Hash` columns are
 * the keyed tokens that make exact-match search work without decrypting every
 * row. The plaintext never lands in a column.
 */
export function contactColumns(input: {
  mobile?: string | null;
  whatsapp?: string | null;
  email?: string | null;
}): Record<string, string | null> {
  return {
    ...(input.mobile !== undefined
      ? { mobile: encryptOptional(input.mobile), mobileHash: mobileToken(input.mobile) }
      : {}),
    ...(input.whatsapp !== undefined ? { whatsapp: encryptOptional(input.whatsapp) } : {}),
    ...(input.email !== undefined
      ? { email: encryptOptional(input.email), emailHash: emailToken(input.email) }
      : {}),
  };
}

/**
 * The fields safe to return to a caller WITHOUT reveal permission.
 *
 * fullName stays visible (front desk must identify the guest, FR-8); contact and
 * ID PII are masked or omitted. This shape is what search/list/profile return by
 * default — the raw encrypted columns never leave the server un-gated.
 */
/**
 * Follow the merge chain to the live survivor.
 *
 * Export/erase of an already-merged (loser) guest must operate on the survivor
 * (design.md § Edge cases). Guards against a cycle by bounding the walk.
 */
export async function resolveToSurvivor(
  prisma: ReturnType<typeof guestDb>,
  orgId: string,
  guestId: string,
): Promise<{ id: string } | null> {
  let currentId = guestId;
  for (let hops = 0; hops < 20; hops++) {
    const guest = await prisma.guest.findFirst({
      where: { id: currentId, orgId },
      select: { id: true, mergedIntoId: true },
    });
    if (!guest) return null;
    if (!guest.mergedIntoId) return { id: guest.id };
    currentId = guest.mergedIntoId;
  }
  return { id: currentId };
}

export const GUEST_SAFE_SELECT = {
  id: true,
  fullName: true,
  city: true,
  state: true,
  companyName: true,
  gstNumber: true,
  mobile: true, // encrypted; masked before returning
  email: true, // encrypted; masked before returning
  whatsapp: true, // encrypted; masked before returning
  createdAt: true,
  deletedAt: true,
  mergedIntoId: true,
} as const;
