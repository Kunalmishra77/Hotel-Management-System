/**
 * Check-in collects the full guest record (client, 5 Nov 2026). A booking made
 * with only name + mobile + address can't be checked in until WhatsApp, gender,
 * nationality, home address and an ID are on file — enforced on the server. Email
 * and date of birth may be skipped (they stay pending).
 */
import { vi } from "vitest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import type { SessionClaims } from "@/lib/auth/claims";

const h = vi.hoisted(() => ({ user: null as SessionClaims | null }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => {
    if (!h.user) throw new Error("no acting user set");
    return h.user;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { ORG_ID, PROP_A_ID, ROOM_104_ID, ROOM_103_ID, USER_RECEPTION_A_ID } from "../../prisma/seed/fixtures";
import { resetRoomsA } from "../../prisma/seed/01-property";
import { assembleClaims } from "@/lib/auth/claims";
import { decryptOptional, encryptString } from "@/lib/crypto/encryption";
import { createReservation } from "@/features/reservations/actions";
import { completeCheckIn } from "@/features/reservations/check-in-gate";
import { saveCheckInDetails } from "@/features/guests/checkin-details-action";

const prisma = createPrismaClient();
const GUEST = "ci_details_guest";
const RETURNING = "ci_details_returning";
let resId = "";
const extraRes: string[] = [];

beforeAll(async () => {
  const c = await assembleClaims(prisma, USER_RECEPTION_A_ID);
  if (!c) throw new Error("no claims");
  h.user = c;
  await resetRoomsA(prisma);
  // As a booking leaves it: name, mobile, address — nothing else.
  await prisma.guest.upsert({
    where: { id: GUEST },
    create: { id: GUEST, orgId: ORG_ID, fullName: "Check-in Details Guest", mobile: encryptString("9800000088"), addressLine: "12 MG Road", city: "Pune" },
    update: { whatsapp: null, gender: null, nationality: null, country: null, email: null, dob: null, deletedAt: null },
  });
  await prisma.guestId.deleteMany({ where: { guestId: GUEST } });
  // A guest from before the full-record rule: name, mobile, one ID — no
  // WhatsApp / gender / nationality / address.
  await prisma.guest.upsert({
    where: { id: RETURNING },
    create: { id: RETURNING, orgId: ORG_ID, fullName: "Returning Old-Form Guest", mobile: encryptString("9800000089") },
    update: { whatsapp: null, gender: null, nationality: null, country: null, addressLine: null, city: null, deletedAt: null },
  });
  await prisma.guestId.deleteMany({ where: { guestId: RETURNING } });
  await prisma.guestId.create({ data: { guestId: RETURNING, type: "DRIVING_LICENCE", maskedValue: "XXXX9876" } });
});

afterAll(async () => {
  for (const id of extraRes) {
    await prisma.roomAllocation.deleteMany({ where: { reservationId: id } });
    await prisma.reservation.updateMany({ where: { id }, data: { status: "CHECKED_OUT" } });
  }
  await prisma.guestId.deleteMany({ where: { guestId: RETURNING } });
  if (resId) {
    await prisma.roomAllocation.deleteMany({ where: { reservationId: resId } });
    await prisma.reservation.updateMany({ where: { id: resId }, data: { status: "CHECKED_OUT" } });
  }
  await prisma.guestId.deleteMany({ where: { guestId: GUEST } });
  await prisma.$disconnect();
});

describe("check-in requires the full guest record", () => {
  it("refuses check-in while details are missing, naming them; accepts once saved without email / DOB", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2028-02-10T05:00:00Z"));
    try {
      const r = await createReservation({ propertyId: PROP_A_ID, source: "DIRECT", adults: 1, children: 0, ratePaise: 200_000, guestId: GUEST, roomIds: [ROOM_104_ID], checkInDate: "2028-02-10", checkOutDate: "2028-02-12" });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) return;
      resId = r.data.id;

      const refused = await completeCheckIn({ reservationId: resId });
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.message).toMatch(/WhatsApp number, gender, nationality, country, a photo ID/);
      expect((await prisma.reservation.findUniqueOrThrow({ where: { id: resId } })).status).toBe("CONFIRMED");

      // Mandatory fields can't be skipped server-side either.
      const bad = await saveCheckInDetails({ guestId: GUEST, gender: "", nationality: "India", addressLine: "12 MG Road", city: "Pune", country: "India" });
      expect(bad.ok).toBe(false);

      const saved = await saveCheckInDetails({ guestId: GUEST, whatsappSameAsMobile: true, gender: "Female", nationality: "India", addressLine: "12 MG Road", city: "Pune", state: "Maharashtra", pincode: "411001", country: "India" });
      expect(saved.ok, JSON.stringify(saved)).toBe(true);
      const g = await prisma.guest.findUniqueOrThrow({ where: { id: GUEST } });
      expect(decryptOptional(g.whatsapp)).toBe(decryptOptional(g.mobile)); // same as mobile
      expect(g.email).toBeNull(); // skipped → stays pending
      expect(g.dob).toBeNull();

      // Still no ID → still refused, now only for that.
      const noId = await completeCheckIn({ reservationId: resId });
      expect(noId.ok).toBe(false);
      if (!noId.ok) expect(noId.error.message).toMatch(/: a photo ID\.$/);

      await prisma.guestId.create({ data: { guestId: GUEST, type: "DRIVING_LICENCE", maskedValue: "XXXX1234" } });
      const ok = await completeCheckIn({ reservationId: resId });
      expect(ok.ok, JSON.stringify(ok)).toBe(true);
      expect((await prisma.reservation.findUniqueOrThrow({ where: { id: resId } })).status).toBe("IN_HOUSE");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a returning guest (stayed before) checks in without re-filling the details (client, 6 Nov 2026)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2028-03-10T05:00:00Z"));
    try {
      // First-time (no earlier stay) → still blocked on the full record.
      const first = await createReservation({ propertyId: PROP_A_ID, source: "DIRECT", adults: 1, children: 0, ratePaise: 200_000, guestId: RETURNING, roomIds: [ROOM_103_ID], checkInDate: "2028-03-10", checkOutDate: "2028-03-11" });
      expect(first.ok, JSON.stringify(first)).toBe(true);
      if (!first.ok) return;
      extraRes.push(first.data.id);
      const blocked = await completeCheckIn({ reservationId: first.data.id });
      expect(blocked.ok).toBe(false);

      // Give them an earlier, checked-out stay → now a returning guest.
      await prisma.reservation.update({ where: { id: first.data.id }, data: { status: "CHECKED_OUT" } });
      await prisma.roomAllocation.deleteMany({ where: { reservationId: first.data.id } });
      await resetRoomsA(prisma);

      const again = await createReservation({ propertyId: PROP_A_ID, source: "DIRECT", adults: 1, children: 0, ratePaise: 200_000, guestId: RETURNING, roomIds: [ROOM_103_ID], checkInDate: "2028-03-10", checkOutDate: "2028-03-11" });
      expect(again.ok, JSON.stringify(again)).toBe(true);
      if (!again.ok) return;
      extraRes.push(again.data.id);
      const ok = await completeCheckIn({ reservationId: again.data.id });
      expect(ok.ok, JSON.stringify(ok)).toBe(true);
      expect((await prisma.reservation.findUniqueOrThrow({ where: { id: again.data.id } })).status).toBe("IN_HOUSE");
    } finally {
      vi.useRealTimers();
    }
  });
});
