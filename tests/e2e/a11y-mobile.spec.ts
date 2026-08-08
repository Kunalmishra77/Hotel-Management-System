/**
 * 17 T-13 — responsive + touch audit at 375px (iPhone-SE width), the smallest
 * viewport mobile-first.md targets. Dependency-free: asserts no horizontal body
 * overflow and that primary actions meet the ≥44px touch-target minimum on both
 * mobile operational surfaces. (A full automated WCAG pass would add
 * @axe-core/playwright — a new dependency gated behind an ADR.)
 *
 * Each surface is checked with a 2FA-off role that can actually reach it:
 * housekeeping → /housekeeping, maintenance → /maintenance.
 */
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const PW = "woodpecker-dev-2026";
const HK = { email: "housekeeping.mg@woodpecker.example" };
const MAINT = { email: "maintenance.mg@woodpecker.example" };
const PROP_A_ID = "prop_wmg";
const ROOM_101_ID = "room_wmg_101";

test.use({ viewport: { width: 375, height: 667 } });

test.beforeAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.housekeepingTask.deleteMany({ where: { roomId: ROOM_101_ID } });
    await prisma.room.update({ where: { id: ROOM_101_ID }, data: { status: "HOUSEKEEPING" } });
    await prisma.housekeepingTask.create({ data: { propertyId: PROP_A_ID, roomId: ROOM_101_ID, type: "CLEANING", status: "PENDING" } });
  } finally {
    await prisma.$disconnect();
  }
});

test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.housekeepingTask.deleteMany({ where: { roomId: ROOM_101_ID } });
    await prisma.room.update({ where: { id: ROOM_101_ID }, data: { status: "VACANT" } });
  } finally {
    await prisma.$disconnect();
  }
});

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "page must not scroll horizontally at 375px").toBeLessThanOrEqual(1);
}

async function expectTouchTarget(page: Page, testId: string): Promise<void> {
  const box = await page.getByTestId(testId).first().boundingBox();
  expect(box, `${testId} should be present`).not.toBeNull();
  expect(box!.height, `${testId} must be a ≥44px touch target`).toBeGreaterThanOrEqual(44);
}

test("housekeeping board fits 375px with tappable actions", async ({ page }) => {
  await signIn(page, HK.email);
  await page.goto("/housekeeping");
  await expect(page.getByTestId("task-101")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectTouchTarget(page, "clean-101");
});

test("maintenance screen fits 375px with tappable actions", async ({ page }) => {
  await signIn(page, MAINT.email);
  await page.goto("/maintenance");
  await expect(page.getByTestId("job-save")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectTouchTarget(page, "job-save");
});
