/**
 * 03-reservations T-32 — the end-to-end journey on a mobile viewport.
 *
 * tasks.md: "Journey: login → search → book → check-in → settle → check-out.
 * (AC-1/9/15/17)"
 *
 * The booking is made for TODAY so it lands in the board's "Arrivals today", can
 * be checked in, then checked out. "Settle" here means the advance covers the
 * total (06's payment ledger isn't built yet), so the balance gate is clear.
 */
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const RECEPTION = { email: "reception.mg@woodpecker.example", password: "woodpecker-dev-2026" };
const GUEST_RAVI_ID = "guest_ravi";

function ymd(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    const rs = await prisma.reservation.findMany({ where: { guestId: GUEST_RAVI_ID }, select: { id: true } });
    const ids = rs.map((r) => r.id);
    if (ids.length) {
      // Free the rooms first (allocations are deletable) so a same-day re-run can
      // re-book. A folio with posted charge lines is append-only and can't be
      // deleted — best-effort remove the empty ones, leave the rest (they no
      // longer hold a room, so they don't block anything).
      await prisma.roomAllocation.deleteMany({ where: { reservationId: { in: ids } } });
      // Registration cards (T6) are deletable — remove them so an empty-folio
      // reservation can still be cleaned; a folio with posted lines stays anyway.
      await prisma.registrationCard.deleteMany({ where: { reservationId: { in: ids } } });
      for (const id of ids) {
        try {
          await prisma.folio.deleteMany({ where: { reservationId: id } });
          await prisma.reservation.deleteMany({ where: { id } });
        } catch {
          /* folio has append-only lines — leave this reservation in place */
        }
      }
    }
    // The wizard captures an Aadhaar on G-RAVI each run — remove it so IDs don't
    // accumulate and the next run starts from a walk-in with none on file.
    await prisma.guestId.deleteMany({ where: { guestId: GUEST_RAVI_ID } });
    // Restore ROOMS-A statuses the journey moved.
    const { resetRoomsA } = await import("../../prisma/seed/01-property");
    await resetRoomsA(prisma);
  } finally {
    await prisma.$disconnect();
  }
});

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(RECEPTION.email);
  // exact: the "Show password" toggle button also contains "password", so a
  // substring getByLabel would match two elements (strict-mode violation).
  await page.getByLabel("Password", { exact: true }).fill(RECEPTION.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Role-based landing: Reception lands on the booking board, not /dashboard.
  await expect(page).toHaveURL(/\/(dashboard|bookings)/);
}

test.describe("journey — search → book → check-in → check-out (T-32)", () => {
  test("reception completes a full stay", async ({ page }) => {
    // The T6 guided check-in adds several steps (verify → identity → register →
    // payment → confirm); the full journey needs more than the 60s default.
    test.setTimeout(150_000);
    await signIn(page);

    // 1 · New booking for today (AC-1/9)
    await page.goto("/bookings/new");
    await page.getByTestId("checkin-date").fill(ymd(0));
    await page.getByTestId("checkout-date").fill(ymd(2));
    await page.getByTestId("check-availability").click();

    // 2 · Pick the first free Deluxe room (AC-9)
    await expect(page.getByTestId("room-options")).toBeVisible();
    await page.getByTestId("room-options").getByRole("button").first().click();

    // 3 · Pick the guest
    await page.getByTestId("guest-search").fill("Ravi");
    await page.getByTestId(`guest-pick-${GUEST_RAVI_ID}`).click();
    await expect(page.getByTestId("selected-guest")).toContainText("Ravi Kumar");

    // 4 · Settle up front so the checkout balance gate is clear, then confirm.
    await page.getByTestId("advance").fill("20000");
    await expect(page.getByTestId("bill-total")).toBeVisible();
    await page.getByTestId("confirm-booking").click();

    // 5 · Back on the board, the booking is an arrival today (AC-1)
    await expect(page).toHaveURL(/\/bookings$/);
    const arrivals = page.getByTestId("section-arrivals");
    await expect(arrivals).toContainText("Ravi Kumar");

    // 6 · Check in via the guided wizard (T6, AC-15). The board's Check-in opens
    // it. Target THIS guest's card, not `.first()`, so other arrivals can't be
    // picked by mistake.
    const raviArrival = arrivals.locator('[data-testid^="reservation-"]').filter({ hasText: "Ravi Kumar" }).first();
    await raviArrival.getByRole("link", { name: "Check in" }).click();
    await expect(page).toHaveURL(/\/check-in$/);

    // Verify → Identity: capture the MoM-mandatory Aadhaar (a walk-in guest has
    // none on file, so Continue stays disabled until one is added) → Register.
    await page.getByTestId("wizard-continue").click();
    await page.getByTestId("id-value").fill("123456789012");
    await page.getByTestId("add-id").click();
    await expect(page.getByTestId("captured-ids")).toBeVisible();
    await page.getByTestId("wizard-continue").click();

    // Sign the registration card (a real pointer stroke), then save.
    const pad = page.getByTestId("signature-pad");
    const box = await pad.boundingBox();
    if (box) {
      await page.mouse.move(box.x + 24, box.y + 40);
      await page.mouse.down();
      await page.mouse.move(box.x + 90, box.y + 70);
      await page.mouse.move(box.x + 170, box.y + 45);
      await page.mouse.up();
    }
    await page.getByTestId("save-registration").click();
    await expect(page.getByTestId("registration-saved")).toBeVisible();
    await page.getByTestId("wizard-continue").click(); // → Payment

    // Payment: the advance already covers the stay, so skip collection → Confirm.
    await page.getByTestId("wizard-continue").click();
    await page.getByTestId("complete-checkin").click();

    // Lands on the booking detail, now IN_HOUSE.
    await expect(page.getByTestId("booking-status")).toHaveText("IN_HOUSE");

    // 7 · Check out from the board — the advance covers the balance (AC-17). The
    // board refreshes client-side after the action; on a laptop -> remote-DB link
    // that refresh can lag, so re-read fresh server state until the card leaves.
    await page.goto("/bookings");
    const inHouse = page.getByTestId("section-in-house");
    const raviInHouse = inHouse.locator('[data-testid^="reservation-"]').filter({ hasText: "Ravi Kumar" }).first();
    await raviInHouse.getByRole("button", { name: "Check out" }).click();
    await expect(async () => {
      await page.reload();
      await expect(page.getByTestId("section-in-house")).not.toContainText("Ravi Kumar");
    }).toPass({ timeout: 45_000 });

    // 8 · The stay is recorded CHECKED_OUT with a folio.
    const prisma = new PrismaClient();
    try {
      const r = await prisma.reservation.findFirst({
        where: { guestId: GUEST_RAVI_ID, status: "CHECKED_OUT" },
        orderBy: { createdAt: "desc" },
        select: { id: true, checkOutAt: true },
      });
      expect(r).not.toBeNull();
      expect(r?.checkOutAt).not.toBeNull();
      expect(await prisma.folio.findFirst({ where: { reservationId: r!.id } })).not.toBeNull();
    } finally {
      await prisma.$disconnect();
    }
  });
});
