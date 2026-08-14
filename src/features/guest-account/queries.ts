import "server-only";
/**
 * Guest-area reads (Phase 2). Only ever return the signed-in guest's OWN data —
 * scoped by the resolved principal, never by a client-supplied id. Contact is
 * decrypted then masked for display (compliance.md).
 */
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { decryptOptional, maskEmail, maskMobile } from "@/lib/crypto/encryption";
import { resolveGuestSession, type GuestPrincipal } from "@/lib/guest-auth";

/** The current guest principal, or redirect to sign-in preserving the destination. */
export async function requireGuest(next?: string): Promise<GuestPrincipal> {
  const principal = await resolveGuestSession();
  if (!principal) {
    redirect(next ? `/account/sign-in?next=${encodeURIComponent(next)}` : "/account/sign-in");
  }
  return principal;
}

export type GuestSummary = {
  fullName: string;
  emailMasked: string | null;
  mobileMasked: string | null;
};

/** Name + masked contact for the signed-in guest. Never exposes raw PII. */
export async function getGuestSummary(principal: GuestPrincipal): Promise<GuestSummary> {
  const account = await db.unscoped().guestAccount.findUnique({
    where: { id: principal.accountId },
    select: { email: true, mobile: true, guest: { select: { fullName: true } } },
  });
  return {
    fullName: account?.guest.fullName ?? "Guest",
    emailMasked: maskEmail(decryptOptional(account?.email ?? null)),
    mobileMasked: maskMobile(decryptOptional(account?.mobile ?? null)),
  };
}
