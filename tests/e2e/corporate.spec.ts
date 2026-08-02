/**
 * 25-corporate-crm T-14 — create corporate + negotiated rate → statement shows
 * the account (AC-1/2/7), on a mobile viewport. Manager holds corporate:manage +
 * report:view-financial (2FA off).
 */
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const MANAGER = { email: "manager.mg@woodpecker.example", password: "woodpecker-dev-2026" };
const NAME = `E2E-CORP-${Date.now()}`;
const CAT_DLX = "cat_wmg_deluxe"; // seeded Deluxe category (fixtures.ts CAT_DLX_ID)

test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    const corps = await prisma.corporate.findMany({ where: { name: { startsWith: "E2E-CORP-" } }, select: { id: true } });
    const ids = corps.map((c) => c.id);
    await prisma.negotiatedRate.deleteMany({ where: { corporateId: { in: ids } } });
    await prisma.corporate.deleteMany({ where: { id: { in: ids } } });
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

test.describe("corporate journey — create → negotiated rate → statement (T-14)", () => {
  test("a manager creates a corporate, sets a negotiated rate, and sees its statement", async ({ page }) => {
    await signIn(page);
    await page.goto("/corporate");

    // 1 · Create the corporate with a ₹2,00,000 credit limit (AC-1)
    await page.getByTestId("corp-name").fill(NAME);
    await page.getByTestId("corp-gstin").fill("29AAACA1234A1Z5");
    await page.getByTestId("corp-limit").fill("200000");
    await page.getByTestId("corp-save").click();

    const row = page.getByTestId("corp-list").locator("li").filter({ hasText: NAME });
    await expect(row).toBeVisible();
    // Fresh account: receivable ₹0, statement present (AC-7)
    await expect(row).toContainText("Receivable ₹0");
    await expect(row).toContainText("Balance ₹0");

    // 2 · Set a negotiated Deluxe rate ₹3,500 (AC-2)
    await row.locator("input").nth(0).fill(CAT_DLX);
    await row.locator("input").nth(1).fill("3500");
    await row.getByRole("button", { name: "Set rate" }).click();

    const after = page.getByTestId("corp-list").locator("li").filter({ hasText: NAME });
    await expect(after).toContainText("₹3,500");
  });
});
