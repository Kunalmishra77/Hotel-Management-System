/**
 * Company credit (client, 23 Nov 2026): a stay billed to a company that pays later
 * checks out with its balance due, is invoiced to the company (naming the guest)
 * and shows under Company dues until the company's payment is recorded.
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
import { checkIn, checkOut } from "@/features/reservations/lifecycle-actions";
import { setCompanyCredit } from "@/features/reservations/company-credit-actions";
import { saveBillingCompany } from "@/features/corporate/billing-companies";
import { recordPayment } from "@/features/billing/payment-actions";
import { companyDues } from "@/features/reports/register-queries";

const prisma = createPrismaClient();
let resId = "";

beforeAll(async () => {
  h.user = await assembleClaims(prisma, USER_ADMIN_ID);
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

describe("company credit", () => {
  it("checks out with the balance due, bills the company, lists it under Company dues until paid", async () => {
    const r = await createReservation({
      propertyId: PROP_A_ID, guestId: GUEST_MEHTA_ID, source: "DIRECT", adults: 1, children: 0, roomIds: [ROOM_103_ID],
      checkInDate: "2027-12-25", checkOutDate: "2027-12-26", ratePaise: 300_000,
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    resId = r.data.id;
    expect((await checkIn({ reservationId: resId })).ok).toBe(true);

    // Without company credit the unpaid balance blocks check-out.
    const blocked = await checkOut({ reservationId: resId });
    expect(blocked.ok).toBe(false);

    const name = `Credit Co ${Date.now()}`;
    const co = await saveBillingCompany({ name, address: "Nehru Place, New Delhi", state: "Delhi" }); // GSTIN "as it comes"
    if (!co.ok) throw new Error(co.error.message);
    expect((await setCompanyCredit({ reservationId: resId, corporateId: co.data.id })).ok).toBe(true);

    const out = await checkOut({ reservationId: resId });
    expect(out.ok, JSON.stringify(out)).toBe(true);

    const folio = await prisma.folio.findFirstOrThrow({ where: { reservationId: resId }, include: { invoices: true } });
    const inv = folio.invoices.find((i) => i.type === "TAX_INVOICE" && !i.supersededById);
    expect(inv?.customerName).toBe(name);
    expect(inv?.customerAddress).toBe("Nehru Place, New Delhi");
    expect(inv?.guestName).toBeTruthy();

    const dues = await companyDues(h.user!, { propertyIds: [PROP_A_ID] });
    const mine = dues.find((d) => d.reservationId === resId);
    expect(mine?.company).toBe(name);
    expect(mine?.duePaise).toBe(315_000);

    // The company pays → recorded on the booking → no longer due.
    expect((await recordPayment({ folioId: folio.id, tenders: [{ mode: "BANK_TRANSFER", amountPaise: 315_000 }] })).ok).toBe(true);
    expect((await companyDues(h.user!, { propertyIds: [PROP_A_ID] })).some((d) => d.reservationId === resId)).toBe(false);
  });
});
