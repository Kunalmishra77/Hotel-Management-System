/**
 * 05-guest-history T-10 — the history section on the guest profile, mobile viewport.
 *
 * tasks.md: "guest with stays → history shows derived metrics" (AC-1/5). A
 * Manager (holds report:view-financial) sees the money; the derivation pipeline
 * itself is covered by the integration suite, so this seeds the snapshot directly
 * and asserts the UI renders it.
 */
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const MANAGER = { email: "manager.mg@woodpecker.example", password: "woodpecker-dev-2026" };
const PROP_A_ID = "prop_wmg";
const CAT_DLX_ID = "cat_wmg_deluxe";
// A seeded guest with a real encrypted mobile (so the profile page decrypts).
// getGuestHistory reads the SNAPSHOT for stats, so we seed that directly; no room
// allocation is needed (avoids the 03 room_no_overlap constraint entirely).
const guestId = "guest_mehta";

test.beforeAll(async () => {
  const prisma = new PrismaClient();
  try {
    const r = await prisma.reservation.create({
      data: {
        propertyId: PROP_A_ID, code: `GHE2E-${Date.now()}`, guestId, status: "CHECKED_OUT",
        source: "WALK_IN", checkInDate: new Date(Date.UTC(2028, 0, 1)), checkOutDate: new Date(Date.UTC(2028, 0, 3)),
        checkOutAt: new Date(Date.UTC(2028, 0, 3)), nights: 2, ratePaise: 400_000,
      },
      select: { id: true },
    });
    const folio = await prisma.folio.create({ data: { propertyId: PROP_A_ID, kind: "RESERVATION", reservationId: r.id }, select: { id: true } });
    await prisma.invoice.create({
      data: {
        propertyId: PROP_A_ID, folioId: folio.id, number: `WMG/2027-28/E2E${Date.now() % 100000}`,
        financialYear: "2027-28", customerName: "Anita Mehta", placeOfSupply: "Karnataka",
        taxableValuePaise: 400_000n, cgstPaise: 24_000, sgstPaise: 24_000, totalPaise: 448_000n,
      },
    });
    await prisma.guestStatsSnapshot.upsert({
      where: { guestId },
      create: { guestId, visits: 1, totalRoomNights: 2, totalRevenuePaise: 400_000n, outstandingPaise: 0n, preferredCategoryId: CAT_DLX_ID, lastStayAt: new Date(Date.UTC(2028, 0, 3)) },
      update: { visits: 1, totalRoomNights: 2, totalRevenuePaise: 400_000n, outstandingPaise: 0n, preferredCategoryId: CAT_DLX_ID, lastStayAt: new Date(Date.UTC(2028, 0, 3)) },
    });
  } finally {
    await prisma.$disconnect();
  }
});

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(MANAGER.email);
  await page.getByLabel("Password").fill(MANAGER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe("guest history section (T-10)", () => {
  test("a manager sees derived metrics + revenue on the profile", async ({ page }) => {
    await signIn(page);
    await page.goto(`/guests/${guestId}`);

    const history = page.getByTestId("guest-history");
    await expect(history).toBeVisible();
    await expect(page.getByTestId("history-visits")).toHaveText("1");
    // Manager holds report:view-financial → revenue is shown, not masked.
    await expect(page.getByTestId("history-revenue")).toHaveText("₹4,000");
    await expect(page.getByTestId("history-bills")).toContainText("WMG/2027-28");
  });
});
