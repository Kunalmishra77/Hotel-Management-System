/**
 * Separate bills on one stay (client, 10 Nov 2026). An OTA booking extended
 * directly at the desk, with food ordered: the OTA's nights get their own
 * invoice (hotel copy, never shared with the guest) and everything paid at the
 * hotel — the extension nights and the food — is the Direct invoice, the only
 * one the guest gets. Each has its own number.
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

import { PROP_A_ID, ROOM_103_ID, GUEST_MEHTA_ID, USER_ADMIN_ID } from "../../prisma/seed/fixtures";
import { resetRoomsA } from "../../prisma/seed/01-property";
import { assembleClaims } from "@/lib/auth/claims";
import { createReservation } from "@/features/reservations/actions";
import { checkIn } from "@/features/reservations/lifecycle-actions";
import { extendStay } from "@/features/reservations/move-actions";
import { postFolioCharge } from "@/features/billing/charge-actions";
import { autoIssueInvoiceOnCheckout, generateInvoice, shareInvoice } from "@/features/billing/invoice-actions";
import { getFolio } from "@/features/billing/queries";

const prisma = createPrismaClient();
let resId = "";

beforeAll(async () => {
  const c = await assembleClaims(prisma, USER_ADMIN_ID);
  if (!c) throw new Error("no claims");
  h.user = c;
  await resetRoomsA(prisma);
});

afterAll(async () => {
  if (resId) {
    await prisma.roomAllocation.deleteMany({ where: { reservationId: resId } });
    await prisma.reservation.updateMany({ where: { id: resId }, data: { status: "CHECKED_OUT" } });
  }
  await resetRoomsA(prisma);
  await prisma.$disconnect();
});

describe("an OTA stay extended directly gets two bills", () => {
  it("MMT night + MMT prepayment on one invoice; direct nights + food on the guest's invoice", async () => {
    // MMT for 1 night at ₹2,000, prepaid online ₹2,100.
    const r = await createReservation({
      propertyId: PROP_A_ID, guestId: GUEST_MEHTA_ID, source: "MAKEMYTRIP", adults: 1, children: 0, roomIds: [ROOM_103_ID],
      checkInDate: "2027-12-01", checkOutDate: "2027-12-02", ratePaise: 200_000, advancePaise: 210_000, advanceMode: "ONLINE",
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    resId = r.data.id;
    expect((await checkIn({ reservationId: resId })).ok).toBe(true);
    // Extended 2 nights directly at ₹2,500, plus a ₹300 dinner.
    expect((await extendStay({ reservationId: resId, newCheckOutDate: "2027-12-04", ratePaise: 250_000, gstMode: "exclusive", source: "DIRECT" })).ok).toBe(true);
    const folioId = (await prisma.folio.findFirstOrThrow({ where: { reservationId: resId }, select: { id: true } })).id;
    expect((await postFolioCharge({ folioId, type: "FOOD", description: "Dinner", unitPaise: 30_000 })).ok).toBe(true);

    const folio = await getFolio(h.user!, folioId);
    expect(folio?.parts.map((p) => [p.part, p.guestBill, p.chargesPaise, p.paidPaise, p.balancePaise])).toEqual([
      ["MAKEMYTRIP", false, 210_000, 210_000, 0],
      ["DIRECT", true, 525_000 + 31_500, 0, 556_500],
    ]);

    // A split stay can't be invoiced as one bill.
    const whole = await generateInvoice({ folioId, customerName: "Mehta" });
    expect(whole.ok).toBe(false);

    // Check-out issues one invoice per bill, each with its own number.
    await autoIssueInvoiceOnCheckout(resId, { renderPdf: false });
    const invoices = await prisma.invoice.findMany({ where: { folioId, type: "TAX_INVOICE" }, include: { lines: true }, orderBy: { number: "asc" } });
    const byPart: Record<string, (typeof invoices)[number]> = Object.fromEntries(invoices.map((i) => [i.billPart ?? "", i]));
    expect(Object.keys(byPart).sort()).toEqual(["DIRECT", "MAKEMYTRIP"]);
    expect(Number(byPart.MAKEMYTRIP!.totalPaise)).toBe(210_000);
    expect(byPart.MAKEMYTRIP!.lines.map((l) => l.type)).toEqual(["ROOM"]);
    expect(Number(byPart.DIRECT!.totalPaise)).toBe(556_500);
    expect(byPart.DIRECT!.lines.map((l) => l.type).sort()).toEqual(["FOOD", "ROOM", "ROOM"]);
    expect(byPart.DIRECT!.number).not.toBe(byPart.MAKEMYTRIP!.number);

    // Idempotent: a second run issues nothing more.
    await autoIssueInvoiceOnCheckout(resId, { renderPdf: false });
    expect(await prisma.invoice.count({ where: { folioId, type: "TAX_INVOICE" } })).toBe(2);

    // Only the direct bill goes to the guest.
    const shareOta = await shareInvoice({ invoiceId: byPart.MAKEMYTRIP!.id });
    expect(shareOta.ok).toBe(false);
    if (!shareOta.ok) expect(shareOta.error.message).toMatch(/hotel's copy/);
  });
});
