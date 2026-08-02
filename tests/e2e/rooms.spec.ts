/**
 * 02-room-inventory T-17 — journey on a mobile viewport.
 *
 * tasks.md: "Journey: create category → create rooms → change status → see it
 * on the board realtime. (AC-1/2/4/11)"
 */
import { expect, test, type Page } from "@playwright/test";
import { authenticator } from "otplib";
import { PrismaClient } from "@prisma/client";

const ADMIN = { email: "admin@woodpecker.example", password: "woodpecker-dev-2026" };
const RECEPTION = { email: "reception.mg@woodpecker.example", password: "woodpecker-dev-2026" };
const HOUSEKEEPING = {
  email: "housekeeping.mg@woodpecker.example",
  password: "woodpecker-dev-2026",
};
const TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

/** Prefix for everything this suite creates, so cleanup is unambiguous. */
const E2E_PREFIX = "E2E";

function uniqueSuffix(): string {
  return Date.now().toString(36).slice(-4).toUpperCase();
}

/**
 * Remove the categories and rooms this suite created.
 * An e2e test that writes real rows must clean up as rigorously as an
 * integration test — leftovers broke three assertions elsewhere in 01.
 */
test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.room.deleteMany({ where: { number: { startsWith: E2E_PREFIX } } });
    await prisma.roomCategory.deleteMany({ where: { name: { startsWith: E2E_PREFIX } } });
    // Restore ROOMS-A statuses that the status-change tests moved.
    const seeded: Record<string, "VACANT" | "OCCUPIED" | "UNDER_MAINTENANCE"> = {
      room_wmg_101: "VACANT",
      room_wmg_102: "VACANT",
      room_wmg_103: "OCCUPIED",
      room_wmg_104: "VACANT",
      room_wmg_105: "OCCUPIED",
      room_wmg_201: "VACANT",
      room_wmg_202: "UNDER_MAINTENANCE",
      room_wmg_203: "OCCUPIED",
      room_wmg_204: "VACANT",
      room_wmg_205: "VACANT",
    };
    for (const [id, status] of Object.entries(seeded)) {
      await prisma.room.updateMany({ where: { id }, data: { status } });
    }
  } finally {
    await prisma.$disconnect();
  }
});

async function signIn(page: Page, who: { email: string; password: string }, totp = false) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  if (totp) {
    await expect(page.getByRole("heading", { name: "Two-factor code" })).toBeVisible();
    await page.getByLabel("Code").fill(authenticator.generate(TOTP_SECRET));
    await page.getByRole("button", { name: "Verify" }).click();
  }
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe("room board (FR-9 / AC-10)", () => {
  test("shows ROOMS-A with live status and category", async ({ page }) => {
    await signIn(page, RECEPTION);
    await page.goto("/rooms");

    await expect(page.getByRole("heading", { name: "Rooms" })).toBeVisible();
    await expect(page.getByTestId("room-chip-101")).toBeVisible();
    // The seeded composition: 6 vacant, 3 occupied, 1 under maintenance.
    await expect(page.getByTestId("room-filter-VACANT")).toContainText("6");
    await expect(page.getByTestId("room-filter-OCCUPIED")).toContainText("3");
    await expect(page.getByTestId("room-filter-UNDER_MAINTENANCE")).toContainText("1");
  });

  test("filters by status", async ({ page }) => {
    await signIn(page, RECEPTION);
    await page.goto("/rooms");

    await page.getByTestId("room-filter-OCCUPIED").click();
    await expect(page.getByTestId("room-chip-103")).toBeVisible(); // seeded OCCUPIED
    await expect(page.getByTestId("room-chip-101")).toHaveCount(0); // seeded VACANT
  });

  test("conveys status by text as well as colour (WCAG 1.4.1)", async ({ page }) => {
    await signIn(page, RECEPTION);
    await page.goto("/rooms");
    // The accessible name carries the status — colour is never the only signal.
    await expect(page.getByLabel(/Room 101.*Vacant/)).toBeVisible();
  });
});

test.describe("role-gated actions (AC-7)", () => {
  test("offers Reception the front-desk transitions but not maintenance", async ({ page }) => {
    await signIn(page, RECEPTION);
    await page.goto("/rooms");
    await page.getByTestId("room-chip-101").click();

    await expect(page.getByRole("dialog", { name: /Room 101/ })).toBeVisible();
    await expect(page.getByTestId("room-action-RESERVED")).toBeVisible();
    await expect(page.getByTestId("room-action-OCCUPIED")).toBeVisible();
    // Taking a room out of sale is a maintenance decision.
    await expect(page.getByTestId("room-action-UNDER_MAINTENANCE")).toHaveCount(0);
  });

  test("offers Housekeeping nothing on a vacant room (AC-7)", async ({ page }) => {
    await signIn(page, HOUSEKEEPING);
    await page.goto("/rooms");
    await page.getByTestId("room-chip-101").click();

    await expect(page.getByRole("dialog", { name: /Room 101/ })).toBeVisible();
    await expect(page.getByText(/can't change this room's status/i)).toBeVisible();
  });
});

test.describe("journey — category → rooms → status change → board (T-17)", () => {
  test("an administrator completes the whole flow", async ({ page }) => {
    const suffix = uniqueSuffix();
    const categoryName = `${E2E_PREFIX}Cat${suffix}`;
    const roomNumber = `${E2E_PREFIX}${suffix}`;

    await signIn(page, ADMIN, true);

    // 1 · Create a category (AC-1)
    await page.goto("/rooms/categories");
    await page.getByLabel("Name").fill(categoryName);
    await page.getByLabel("Nightly rate (₹)").fill("4000");
    await page.getByLabel("Max adults").fill("2");
    await page.getByLabel("Max children").fill("1");
    await page.getByLabel("HSN/SAC").fill("996311");
    await page.getByRole("button", { name: "Add category" }).click();

    // Rupees in, integer paise stored, ₹4,000 displayed back.
    await expect(page.getByTestId(`category-${categoryName}`)).toBeVisible();
    await expect(page.getByTestId(`category-${categoryName}`)).toContainText("4,000");

    // 2 · Create a room in it (AC-2)
    await page.getByLabel("Number").fill(roomNumber);
    await page.getByLabel("Category").selectOption({ label: categoryName });
    await page.getByRole("button", { name: "Add room" }).click();
    await expect(page.getByText(`Added room ${roomNumber}`)).toBeVisible();

    // 3 · It appears on the board, VACANT (AC-2)
    await page.goto("/rooms");
    const chip = page.getByTestId(`room-chip-${roomNumber}`);
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("data-status", "VACANT");

    // 4 · Change its status (AC-4) — VACANT → RESERVED
    await chip.click();
    await page.getByTestId("room-action-RESERVED").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId(`room-chip-${roomNumber}`)).toHaveAttribute(
      "data-status",
      "RESERVED",
    );
  });

  test("rejects a duplicate room number (AC-3)", async ({ page }) => {
    await signIn(page, ADMIN, true);
    await page.goto("/rooms/categories");

    await page.getByLabel("Number").fill("101"); // already exists in PROP-A
    await page.getByRole("button", { name: "Add room" }).click();

    await expect(page.locator("#room-error")).toContainText(/already exists/i);
  });
});

test.describe("illegal transitions (AC-6)", () => {
  test("never offers OCCUPIED from a room under maintenance", async ({ page }) => {
    await signIn(page, ADMIN, true);
    await page.goto("/rooms");

    // Room 202 is seeded UNDER_MAINTENANCE.
    await page.getByTestId("room-chip-202").click();
    await expect(page.getByRole("dialog", { name: /Room 202/ })).toBeVisible();

    // The only legal exit is VACANT — the state machine, not the UI, decides.
    await expect(page.getByTestId("room-action-VACANT")).toBeVisible();
    await expect(page.getByTestId("room-action-OCCUPIED")).toHaveCount(0);
    await expect(page.getByTestId("room-action-RESERVED")).toHaveCount(0);
  });
});
