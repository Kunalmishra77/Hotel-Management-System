/**
 * 13 · Booking Channel Integrations — T-2 seed fixtures
 * (specs/13-booking-channel-integrations/user-stories.md § Test Fixtures).
 *
 * CH-BDC   — ChannelAccount(provider booking_com, sandbox, inactive) @ PROP-A.
 * MAP-DLX  — RoomTypeMapping external "DLX-BB" → internal CAT-DLX.
 * RES-EXT  — a deterministic mock-pull fixture (externalId BDC-9001, DLX-BB,
 *            12–15 Jul) carried on the account `config.fixtures`, so the mock
 *            adapter pulls it with zero external accounts (FR-3).
 *
 * Idempotent (fixed ids / upserts), like every seed module.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { CAT_DLX_ID, PROP_A_ID } from "./fixtures";

/** CH-BDC — the sandbox Booking.com channel account. */
export const CHANNEL_BDC_ID = "chan_bdc_wmg";
/** MAP-DLX — external "DLX-BB" → CAT-DLX. */
export const MAPPING_DLX_ID = "chanmap_dlx_bb";
/** RES-EXT — the inbound OTA reservation fixture. */
export const RES_EXT_EXTERNAL_ID = "BDC-9001";

export function resExtFixturePayload(): Record<string, unknown> {
  return {
    propertyId: PROP_A_ID,
    externalId: RES_EXT_EXTERNAL_ID,
    type: "reservation.new",
    roomType: "DLX-BB",
    ratePlan: "BB",
    guest: { name: "Otto Aggregator", phone: "9900112233", email: "otto@example.com" },
    checkIn: "2026-07-12",
    checkOut: "2026-07-15",
    adults: 2,
    children: 0,
    amounts: { rate: 4000, tax: 480, advance: 0 },
  };
}

export async function seedChannels(prisma: PrismaClient): Promise<void> {
  // Upsert by the natural (property, provider) key and use the RESULTING id for
  // the mapping — a leftover account from a prior test run may already own this
  // (property, provider) under a different id, so never assume CHANNEL_BDC_ID.
  const account = await prisma.channelAccount.upsert({
    where: { propertyId_provider: { propertyId: PROP_A_ID, provider: "booking_com" } },
    create: {
      id: CHANNEL_BDC_ID,
      propertyId: PROP_A_ID,
      provider: "booking_com",
      isActive: false,
      config: {
        // Deterministic mock-pull fixtures (the mock adapter reads config.fixtures).
        fixtures: [
          {
            provider: "booking_com",
            externalId: RES_EXT_EXTERNAL_ID,
            type: "reservation.new",
            payload: resExtFixturePayload(),
          },
        ],
      } as Prisma.InputJsonValue,
    },
    update: { isActive: false },
    select: { id: true },
  });

  await prisma.roomTypeMapping.upsert({
    where: {
      channelAccountId_externalRoomType: {
        channelAccountId: account.id,
        externalRoomType: "DLX-BB",
      },
    },
    create: {
      channelAccountId: account.id,
      roomCategoryId: CAT_DLX_ID,
      externalRoomType: "DLX-BB",
      externalRatePlan: "BB",
    },
    update: { roomCategoryId: CAT_DLX_ID },
  });
}
