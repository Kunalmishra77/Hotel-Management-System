/**
 * 04 · Guest CRM — T-2/T-3 seed fixtures.
 *
 * specs/04-guest-crm/user-stories.md § Test Fixtures: G-RAVI, G-RAVI2 (same
 * mobile — a duplicate), G-MEHTA (company + GSTIN).
 *
 * Contact is stored the way the app stores it: ENCRYPTED, with keyed `*Hash`
 * search tokens — so seeded guests behave exactly like created ones (search and
 * dedupe find them).
 *
 * The 100k-guest scale seed is a separate opt-in path — see `--scale` in
 * prisma/seed/index.ts — not part of the default fixtures.
 */
import type { PrismaClient } from "@prisma/client";
import { encryptString, keyedHash } from "../../src/lib/crypto/encryption";
import { normalizeEmail, normalizePhone } from "../../src/features/guests/domain/normalize";
import {
  GUEST_MEHTA_ID,
  GUEST_RAVI2_ID,
  GUEST_RAVI_EMAIL,
  GUEST_RAVI_ID,
  GUEST_RAVI_MOBILE,
  ORG_ID,
} from "./fixtures";

function mobileHash(mobile: string): string {
  return keyedHash(normalizePhone(mobile) ?? mobile);
}
function emailHash(email: string): string {
  return keyedHash(normalizeEmail(email) ?? email.toLowerCase());
}

export async function seedGuests(prisma: PrismaClient): Promise<void> {
  await prisma.guest.upsert({
    where: { id: GUEST_RAVI_ID },
    create: {
      id: GUEST_RAVI_ID,
      orgId: ORG_ID,
      fullName: "Ravi Kumar",
      mobile: encryptString(GUEST_RAVI_MOBILE),
      mobileHash: mobileHash(GUEST_RAVI_MOBILE),
      email: encryptString(GUEST_RAVI_EMAIL),
      emailHash: emailHash(GUEST_RAVI_EMAIL),
      city: "Bengaluru",
      state: "Karnataka",
    },
    update: {
      // Keep contact tokens correct on re-seed (erase tests null them out).
      fullName: "Ravi Kumar",
      mobile: encryptString(GUEST_RAVI_MOBILE),
      mobileHash: mobileHash(GUEST_RAVI_MOBILE),
      email: encryptString(GUEST_RAVI_EMAIL),
      emailHash: emailHash(GUEST_RAVI_EMAIL),
      deletedAt: null,
      mergedIntoId: null,
    },
  });

  // G-RAVI2 — same mobile as G-RAVI: the intentional duplicate (AC-3/AC-11).
  await prisma.guest.upsert({
    where: { id: GUEST_RAVI2_ID },
    create: {
      id: GUEST_RAVI2_ID,
      orgId: ORG_ID,
      fullName: "Ravi K",
      mobile: encryptString(GUEST_RAVI_MOBILE),
      mobileHash: mobileHash(GUEST_RAVI_MOBILE),
      city: "Bengaluru",
    },
    update: {
      fullName: "Ravi K",
      mobile: encryptString(GUEST_RAVI_MOBILE),
      mobileHash: mobileHash(GUEST_RAVI_MOBILE),
      deletedAt: null,
      mergedIntoId: null,
    },
  });

  // G-MEHTA — company + GSTIN, for the company/GST search cases.
  await prisma.guest.upsert({
    where: { id: GUEST_MEHTA_ID },
    create: {
      id: GUEST_MEHTA_ID,
      orgId: ORG_ID,
      fullName: "Anita Mehta",
      mobile: encryptString("9800000002"),
      mobileHash: mobileHash("9800000002"),
      companyName: "ACME",
      gstNumber: "29AABCW1234F1ZJ",
      city: "Bengaluru",
    },
    update: {
      // Restore every field the erase test scrubs, so re-seeding is truly
      // idempotent (an erased guest must return to a valid, searchable state —
      // not a half-scrubbed row with a non-decryptable mobile).
      fullName: "Anita Mehta",
      mobile: encryptString("9800000002"),
      mobileHash: mobileHash("9800000002"),
      emailHash: null,
      companyName: "ACME",
      gstNumber: "29AABCW1234F1ZJ",
      deletedAt: null,
      mergedIntoId: null,
    },
  });

  // Reset the two test guests' IDs to a clean slate (add-id/erase tests mutate).
  await prisma.guestId.deleteMany({
    where: { guestId: { in: [GUEST_RAVI_ID, GUEST_RAVI2_ID, GUEST_MEHTA_ID] } },
  });
}
