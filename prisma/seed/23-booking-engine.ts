/**
 * 23 · Booking Engine seed — CFG fixture for the public booking site (T-2).
 *
 * specs/23-booking-engine/user-stories.md § Test Fixtures:
 *   PROP-A public slug `woodpecker-mg`, GST-inclusive display.
 *   CFG: onlineSellable CAT-DLX; deposit=20%; TTL=15min; minLOS 1; cancel 48h.
 *   PAY: sandbox (no live creds).
 *
 * Idempotent: fixed slug + unique propertyId, upserted.
 */
import type { PrismaClient } from "@prisma/client";
import { PROP_A_ID, CAT_DLX_ID } from "./fixtures";

export const BOOKING_ENGINE_SLUG = "woodpecker-mg";

export async function seedBookingEngine(prisma: PrismaClient): Promise<void> {
  await prisma.bookingEngineConfig.upsert({
    where: { propertyId: PROP_A_ID },
    create: {
      propertyId: PROP_A_ID,
      slug: BOOKING_ENGINE_SLUG,
      onlineSellableCategoryIds: [CAT_DLX_ID],
      depositPolicy: "PCT",
      depositValue: 2000, // basis points → 20%
      checkoutTtlMin: 15,
      minLos: 1,
      maxLos: null,
      leadTimeDays: 0,
      maxRoomsPerBooking: 5,
      cancelWindowHours: 48,
      gatewayProvider: "sandbox",
      isPublished: true,
    },
    update: {
      slug: BOOKING_ENGINE_SLUG,
      onlineSellableCategoryIds: [CAT_DLX_ID],
      depositPolicy: "PCT",
      depositValue: 2000,
      checkoutTtlMin: 15,
      minLos: 1,
      cancelWindowHours: 48,
      gatewayProvider: "sandbox",
      isPublished: true,
    },
  });
}
