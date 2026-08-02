/**
 * 03 · Reservations — T-4 seed fixtures.
 *
 * specs/03-reservations/user-stories.md § Test Fixtures. Most of what this
 * module's tests need already exists: PROP-A, CAT-DLX/CAT-STE, the Deluxe rooms
 * (101–104) and Suite (201), and the guests (from 01/02/04). What's missing is
 * the **ACME corporate** account and its link to G-MEHTA (AC-21 revenue
 * attribution).
 *
 * The RoomBlock exclusion cases (R-103 14–20 Jul, R-104 15–16 Jul) are created
 * *inside* the tests that need them, not baked in here — otherwise they would
 * fight 02's `resetRoomsA`, and a per-test block is the honest arrange step for
 * an availability assertion anyway.
 */
import type { PrismaClient } from "@prisma/client";
import { CORPORATE_ACME_ID, GUEST_MEHTA_ID, ORG_ID } from "./fixtures";

export async function seedReservations(prisma: PrismaClient): Promise<void> {
  // ACME — corporate account with a credit limit, for corporate attribution.
  await prisma.corporate.upsert({
    where: { id: CORPORATE_ACME_ID },
    create: {
      id: CORPORATE_ACME_ID,
      orgId: ORG_ID,
      name: "ACME Corp",
      gstin: "29AAACA1234A1Z5",
      contactName: "Anita Mehta",
      contactPhone: "9800000002",
      creditLimitPaise: 20_000_000n, // ₹200,000 in paise
    },
    update: {
      name: "ACME Corp",
      gstin: "29AAACA1234A1Z5",
      creditLimitPaise: 20_000_000n,
    },
  });

  // G-MEHTA is ACME's guest — links a guest to the corporate for AC-21.
  await prisma.guest.update({
    where: { id: GUEST_MEHTA_ID },
    data: { companyName: "ACME Corp" },
  });
}
