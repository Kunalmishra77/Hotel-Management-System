/**
 * 19 POS e2e (T-19) — create order → KOT → settle to an in-house folio, then
 * verify 06 wrote the FolioLine(POS/FOOD). Mobile viewport, reception user.
 *
 * Fixtures (outlet + menu + an IN_HOUSE reservation) are created here with unique
 * ids; teardown removes only this module's rows (folio/reservation are
 * append-only / FK-restricted and left in place).
 */
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const RECEPTION = { email: "reception.mg@woodpecker.example", password: "woodpecker-dev-2026" };
const PROP_A_ID = "prop_wmg";
const GUEST_MEHTA_ID = "guest_mehta";
const RUN = Date.now().toString(36);
const OUTLET_ID = `outlet_e2e_${RUN}`;
const DOSA_ID = `menu_e2e_dosa_${RUN}`;
let reservationId = "";

test.beforeAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.posOutlet.create({ data: { id: OUTLET_ID, propertyId: PROP_A_ID, name: `E2E-REST-${RUN}`, defaultGstBps: 500 } });
    await prisma.menuItem.create({ data: { id: DOSA_ID, propertyId: PROP_A_ID, outletId: OUTLET_ID, name: "E2E Masala Dosa", ratePaise: 12_000, hsnSac: "996331", gstBps: 500 } });
    const r = await prisma.reservation.create({
      data: {
        propertyId: PROP_A_ID, code: `POS-E2E-${RUN}`, guestId: GUEST_MEHTA_ID, status: "IN_HOUSE",
        source: "WALK_IN", checkInDate: new Date("2036-02-10"), checkOutDate: new Date("2036-02-12"), nights: 2, ratePaise: 400_000,
      },
      select: { id: true },
    });
    reservationId = r.id;
  } finally {
    await prisma.$disconnect();
  }
});

test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.posOrderItem.deleteMany({ where: { order: { outletId: OUTLET_ID } } });
    await prisma.posOrder.deleteMany({ where: { outletId: OUTLET_ID } });
    await prisma.menuItem.deleteMany({ where: { outletId: OUTLET_ID } });
    await prisma.posOutlet.deleteMany({ where: { id: OUTLET_ID } });
  } finally {
    await prisma.$disconnect();
  }
});

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(RECEPTION.email);
  await page.getByLabel("Password", { exact: true }).fill(RECEPTION.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe("POS journey — create → KOT → settle to folio (T-19)", () => {
  test("reception captures an order and settles it to an in-house folio", async ({ page }) => {
    await signIn(page);
    await page.goto(`/pos?outletId=${OUTLET_ID}&reservationId=${reservationId}`);

    // 1 · Start an order linked to the in-house reservation (AC-1)
    await page.getByTestId("pos-new-order").click();
    await expect(page.getByTestId("pos-menu")).toBeVisible();

    // 2 · Add a menu item; the live bill reflects it (AC-2)
    await page.getByTestId(`menu-${DOSA_ID}`).click();
    await expect(page.getByTestId("bill-subtotal")).toContainText("120.00");
    await expect(page.getByTestId("bill-total")).toContainText("126.00"); // ₹120 + 5%

    // 3 · Send to kitchen without settling (AC-12)
    await page.getByTestId("pos-kot").click();

    // 4 · Settle to folio (AC-5)
    await page.getByTestId("pos-settle-folio").click();
    await expect(page.getByTestId("pos-new-order")).toBeVisible(); // back to the start view

    // 5 · Verify 06 wrote the FolioLine(POS/FOOD) on the reservation's folio
    const prisma = new PrismaClient();
    try {
      const order = await prisma.posOrder.findFirstOrThrow({ where: { reservationId, outletId: OUTLET_ID } });
      expect(order.status).toBe("SETTLED");
      const folio = await prisma.folio.findFirstOrThrow({ where: { reservationId } });
      const line = await prisma.folioLine.findFirstOrThrow({ where: { folioId: folio.id, description: `POS ${order.code}` } });
      expect(line.type).toBe("FOOD");
      expect(line.cgstPaise).toBe(300); // 5% of ₹120 → CGST ₹3 + SGST ₹3
      expect(line.sgstPaise).toBe(300);
    } finally {
      await prisma.$disconnect();
    }
  });
});
