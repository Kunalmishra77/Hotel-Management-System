/**
 * 19 addendum T-29 — guest in-room QR ordering, end-to-end on the production
 * server. A guest (no auth) orders from /order/<token>; staff accept it from the
 * POS Room-orders inbox; the order posts to the room folio (FolioLine type=FOOD).
 * Plus the occupied-gate (a room with no in-house stay shows "unavailable").
 *
 * Money rows are append-only, so this leaves its reservation/folio behind and a
 * fresh set is seeded per run; teardown removes only its POS/room rows.
 */
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const REC = { email: "reception.mg@woodpecker.example", password: "woodpecker-dev-2026" };
const PROP_A_ID = "prop_wmg";
const GUEST_ID = "guest_mehta";
const RUN = Date.now().toString(36);
const CAT_ID = `cat_e2e_${RUN}`;
const ROOM_OCC = `room_e2e_occ_${RUN}`;
const ROOM_VAC = `room_e2e_vac_${RUN}`;
const OUTLET_ID = `outlet_e2e_${RUN}`;
const DOSA_ID = `menu_e2e_${RUN}`;
const RES_ID = `res_e2e_${RUN}`;
const TOKEN_OCC = `e2e_occ_${RUN}`;
const TOKEN_VAC = `e2e_vac_${RUN}`;

test.beforeAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.roomCategory.create({ data: { id: CAT_ID, propertyId: PROP_A_ID, name: `E2E-${RUN}`, baseRatePaise: 300_000, maxAdults: 2, maxChildren: 1, gstBps: 1200 } });
    await prisma.room.createMany({
      data: [
        { id: ROOM_OCC, propertyId: PROP_A_ID, categoryId: CAT_ID, number: `E2EO-${RUN}`, orderToken: TOKEN_OCC },
        { id: ROOM_VAC, propertyId: PROP_A_ID, categoryId: CAT_ID, number: `E2EV-${RUN}`, orderToken: TOKEN_VAC },
      ],
    });
    await prisma.posOutlet.create({ data: { id: OUTLET_ID, propertyId: PROP_A_ID, name: `E2E-REST-${RUN}`, defaultGstBps: 500, isRoomDining: true } });
    await prisma.menuItem.create({ data: { id: DOSA_ID, propertyId: PROP_A_ID, outletId: OUTLET_ID, name: "Masala Dosa", ratePaise: 12_000, hsnSac: "996331", gstBps: 500 } });
    await prisma.reservation.create({ data: { id: RES_ID, propertyId: PROP_A_ID, code: `E2E-RES-${RUN}`, guestId: GUEST_ID, status: "IN_HOUSE", source: "WALK_IN", checkInDate: new Date("2037-01-10"), checkOutDate: new Date("2037-01-12"), nights: 2, ratePaise: 400_000 } });
    await prisma.roomAllocation.create({ data: { propertyId: PROP_A_ID, reservationId: RES_ID, roomId: ROOM_OCC, startDate: new Date("2037-01-10"), endDate: new Date("2037-01-12") } });
  } finally {
    await prisma.$disconnect();
  }
});

test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.kitchenTicket.deleteMany({ where: { outletId: OUTLET_ID } });
    await prisma.posOrderItem.deleteMany({ where: { order: { outletId: OUTLET_ID } } });
    await prisma.posOrder.deleteMany({ where: { outletId: OUTLET_ID } });
    await prisma.menuItem.deleteMany({ where: { outletId: OUTLET_ID } });
    await prisma.posOutlet.deleteMany({ where: { id: OUTLET_ID } });
    await prisma.roomAllocation.deleteMany({ where: { reservationId: RES_ID } });
    await prisma.room.deleteMany({ where: { id: { in: [ROOM_OCC, ROOM_VAC] } } });
    await prisma.roomCategory.deleteMany({ where: { id: CAT_ID } });
  } finally {
    await prisma.$disconnect();
  }
});

async function signIn(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(REC.email);
  await page.getByLabel("Password", { exact: true }).fill(REC.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

test("guest orders via QR → staff accepts → posts to the room folio (T-29)", async ({ page }) => {
  // 1 · Guest (no auth) opens the in-room page and orders.
  await page.goto(`/order/${TOKEN_OCC}`);
  await expect(page.getByTestId("guest-menu")).toBeVisible();
  await page.getByTestId(`add-${DOSA_ID}`).click();
  await page.getByTestId("guest-submit").click();
  await expect(page.getByTestId("order-sent")).toBeVisible();

  // 2 · Find THIS order's code so we accept exactly it (the inbox lists all
  // pending orders for the property, which may include others).
  const setup = new PrismaClient();
  let code: string;
  try {
    code = (await setup.posOrder.findFirstOrThrow({ where: { outletId: OUTLET_ID }, select: { code: true } })).code;
  } finally {
    await setup.$disconnect();
  }

  // 3 · Staff sign in and accept it from the Room-orders inbox.
  await signIn(page);
  await page.goto("/pos");
  const accept = page.getByTestId(`accept-${code}`);
  await expect(accept).toBeVisible();
  await accept.click();

  // 4 · A FOOD folio line lands on the room's folio (in-DB). Poll for the LINE,
  // not the order status: settleToFolio is a SAGA that flips the order to SETTLED
  // in the claim tx BEFORE postFolioCharge commits the line, so gating on SETTLED
  // would race the charge across the pooler.
  const prisma = new PrismaClient();
  try {
    await expect
      .poll(
        async () => {
          const folio = await prisma.folio.findFirst({ where: { reservationId: RES_ID }, select: { id: true } });
          if (!folio) return null;
          const line = await prisma.folioLine.findFirst({ where: { folioId: folio.id, type: "FOOD" }, select: { id: true } });
          return line ? "posted" : null;
        },
        { timeout: 20_000 },
      )
      .toBe("posted");

    const folio = await prisma.folio.findFirstOrThrow({ where: { reservationId: RES_ID }, select: { id: true } });
    const line = await prisma.folioLine.findFirstOrThrow({ where: { folioId: folio.id, type: "FOOD" } });
    expect((line.cgstPaise ?? 0) > 0 && (line.sgstPaise ?? 0) > 0 && line.igstPaise === 0).toBe(true);
    expect(await prisma.kitchenTicket.count({ where: { outletId: OUTLET_ID } })).toBe(1);
  } finally {
    await prisma.$disconnect();
  }
});

test("occupied-gate: a room with no in-house stay shows unavailable (T-29)", async ({ page }) => {
  await page.goto(`/order/${TOKEN_VAC}`);
  await expect(page.getByTestId("order-unavailable")).toBeVisible();
  await expect(page.getByTestId("guest-menu")).toHaveCount(0);
});
