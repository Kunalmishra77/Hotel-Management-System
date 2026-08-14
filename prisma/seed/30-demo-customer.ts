/**
 * 30 — Demo customer-journey enrichment (customer redesign). Makes the whole
 * customer-first flow demoable end-to-end without any live account creation:
 *   • a LOGIN-ABLE guest account attached to an existing in-house stay
 *     (so "sign in as a guest → My stay" works immediately),
 *   • an open in-room service request for that stay (→ the /requests inbox),
 *   • a couple of Lost & Found items,
 *   • a large DRAFT expense that trips the approval-escalation (→ Super Admin).
 *
 * Additive + idempotent (fixed ids / hash guards). Gated behind SEED_DEMO like
 * 27–29, so it never pollutes the minimal fixture state the tests assert against.
 */
import type { PrismaClient } from "@prisma/client";
import { encryptString } from "../../src/lib/crypto/encryption";
import { mobileHashOf, emailHashOf, normalizeMobile } from "../../src/lib/guest-auth/contact";
import { hashPassword } from "../../src/lib/auth/password";
import { ORG_ID, PROP_A_ID } from "./fixtures";

export const DEMO_GUEST_EMAIL = "guest.demo@woodpecker.example";
export const DEMO_GUEST_PASSWORD = "woodpecker-guest-2026";
const DEMO_GUEST_MOBILE = "9000000009";

export async function seedDemoCustomer(prisma: PrismaClient): Promise<void> {
  // Attach the demo journey to a real in-house stay at the flagship property.
  const stay = await prisma.reservation.findFirst({
    where: { propertyId: PROP_A_ID, status: "IN_HOUSE" },
    orderBy: { checkInDate: "asc" },
    select: { id: true, guestId: true, allocations: { take: 1, select: { roomId: true } } },
  });
  if (!stay) return; // no in-house stay to attach to — skip quietly

  const roomId = stay.allocations[0]?.roomId ?? null;
  const emailHash = emailHashOf(DEMO_GUEST_EMAIL);
  const mobileHash = mobileHashOf(DEMO_GUEST_MOBILE);

  // 1) A login-able guest account linked to the in-house guest (idempotent).
  const existing = await prisma.guestAccount.findFirst({ where: { orgId: ORG_ID, emailHash }, select: { id: true } });
  if (!existing) {
    await prisma.guestAccount.create({
      data: {
        orgId: ORG_ID,
        guestId: stay.guestId,
        email: encryptString(DEMO_GUEST_EMAIL),
        emailHash,
        mobile: encryptString(normalizeMobile(DEMO_GUEST_MOBILE)),
        mobileHash,
        passwordHash: await hashPassword(DEMO_GUEST_PASSWORD),
        emailVerifiedAt: new Date(),
        phoneVerifiedAt: new Date(),
      },
    });
  }

  // 2) An open in-room request for that stay (populates the reception inbox).
  await prisma.guestRequest.upsert({
    where: { id: "gr_demo_1" },
    update: {},
    create: {
      id: "gr_demo_1",
      orgId: ORG_ID,
      propertyId: PROP_A_ID,
      reservationId: stay.id,
      roomId,
      guestId: stay.guestId,
      kind: "HOUSEKEEPING",
      detail: "Extra towels and a bottle of water, please.",
      status: "OPEN",
    },
  });

  // 3) Lost & Found — one stored, one already claimed.
  await prisma.lostAndFoundItem.upsert({
    where: { id: "lf_demo_1" },
    update: {},
    create: { id: "lf_demo_1", orgId: ORG_ID, propertyId: PROP_A_ID, roomId, description: "Black phone charger", foundOn: new Date(), status: "STORED" },
  });
  await prisma.lostAndFoundItem.upsert({
    where: { id: "lf_demo_2" },
    update: {},
    create: { id: "lf_demo_2", orgId: ORG_ID, propertyId: PROP_A_ID, description: "Blue umbrella", foundOn: new Date(), status: "CLAIMED", claimantName: "A. Sharma", resolvedOn: new Date() },
  });

  // 4) A large DRAFT expense (> ₹25,000) — trips approval escalation to Super Admin.
  await prisma.expense.upsert({
    where: { id: "exp_demo_large" },
    update: {},
    create: {
      id: "exp_demo_large",
      propertyId: PROP_A_ID,
      head: "UTILITIES",
      subCategory: "Diesel genset overhaul",
      amountPaise: 3_000_000, // ₹30,000
      spentOn: new Date(),
      status: "DRAFT",
    },
  });
}
