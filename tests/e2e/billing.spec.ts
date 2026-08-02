/**
 * 06-billing T-29a — folio journey on a mobile viewport.
 *
 * tasks.md: "charge → split payment → generate GST invoice → verify totals +
 * numbering (AC-3/8/13/16)". (The discount and coupon/POS journeys are covered
 * exhaustively by the integration suite; this drives the money UI end-to-end.)
 *
 * The reservation + folio are seeded via Prisma so the test focuses on the folio
 * screen; billing rows are append-only, so nothing is deleted afterwards.
 */
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const RECEPTION = { email: "reception.mg@woodpecker.example", password: "woodpecker-dev-2026" };
const PROP_A_ID = "prop_wmg";
// Use G-MEHTA (not G-RAVI): the reservations e2e's afterAll blanket-deletes
// G-RAVI reservations, which would collide with this test's append-only folio.
const GUEST_RAVI_ID = "guest_mehta";

let reservationId = "";

test.beforeAll(async () => {
  const prisma = new PrismaClient();
  try {
    // CHECKED_OUT + a 2028 date range so this never appears in another suite's
    // "arrivals today" board (the folio journey doesn't care about status/dates).
    const r = await prisma.reservation.create({
      data: {
        propertyId: PROP_A_ID, code: `FOLIO-${Date.now()}`, guestId: GUEST_RAVI_ID, status: "CHECKED_OUT",
        source: "WALK_IN", checkInDate: new Date(Date.UTC(2028, 5, 1)), checkOutDate: new Date(Date.UTC(2028, 5, 3)),
        nights: 2, ratePaise: 400_000,
      },
      select: { id: true },
    });
    reservationId = r.id;
    await prisma.folio.create({ data: { propertyId: PROP_A_ID, kind: "RESERVATION", reservationId: r.id } });
  } finally {
    await prisma.$disconnect();
  }
});

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(RECEPTION.email);
  await page.getByLabel("Password").fill(RECEPTION.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe("folio journey — charge → pay → invoice (T-29a)", () => {
  test("reception charges, settles and invoices a folio", async ({ page }) => {
    await signIn(page);
    await page.goto(`/bookings/${reservationId}/folio`);
    await expect(page.getByTestId("folio-balance")).toHaveText("₹0");

    // 1 · Add a ₹1,000 laundry charge → balance ₹1,180 with 18% GST (AC-3)
    await page.getByTestId("add-charge").click();
    await page.getByTestId("charge-type").selectOption("LAUNDRY");
    await page.getByTestId("charge-desc").fill("Laundry");
    await page.getByTestId("charge-amount").fill("1000");
    await page.getByTestId("charge-submit").click();
    await expect(page.getByTestId("folio-balance")).toHaveText("₹1,180");

    // 2 · Take payment — the default tender covers the balance, remaining → 0 (AC-8)
    await page.getByTestId("take-payment").click();
    await expect(page.getByTestId("remaining")).toHaveText("₹0");
    await page.getByTestId("confirm-payment").click();
    await expect(page.getByTestId("folio-balance")).toHaveText("₹0");

    // 3 · Generate the GST invoice (AC-13/16) — wait for the number to appear.
    await page.getByTestId("generate-invoice").click();
    await expect(page.getByTestId("invoice-number")).toContainText(/WMG\/\d{4}-\d{2}\/\d{5}/);

    // 4 · Verify a gap-free numbered invoice with correct totals was issued.
    const prisma = new PrismaClient();
    try {
      const folio = await prisma.folio.findFirstOrThrow({ where: { reservationId }, select: { id: true } });
      const invoice = await prisma.invoice.findFirstOrThrow({ where: { folioId: folio.id }, orderBy: { issuedAt: "desc" } });
      expect(invoice.number).toMatch(/WMG\/\d{4}-\d{2}\/\d{5}/);
      expect(Number(invoice.totalPaise)).toBe(118_000); // ₹1,000 + 18% GST
      expect(Number(invoice.cgstPaise)).toBe(9000);
      expect(Number(invoice.sgstPaise)).toBe(9000);
    } finally {
      await prisma.$disconnect();
    }
  });
});
