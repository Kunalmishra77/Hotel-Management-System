/**
 * 07-expenses T-11 — record → approve → appears in the daily rollup (AC-1/4/5),
 * on a mobile viewport. Manager holds expense:create + expense:approve (2FA off).
 */
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const MANAGER = { email: "manager.mg@woodpecker.example", password: "woodpecker-dev-2026" };
const SUB = `E2E-${Date.now()}`;

test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.expense.deleteMany({ where: { subCategory: { startsWith: "E2E-" } } });
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

test.describe("expense journey — record → approve → rollup (T-11)", () => {
  test("a manager records and approves an expense, and it hits today's total", async ({ page }) => {
    await signIn(page);
    await page.goto("/expenses");

    // 1 · Record a ₹1,200 kitchen expense for today (AC-1)
    await page.getByTestId("expense-head").selectOption("KITCHEN");
    await page.getByTestId("expense-sub").fill(SUB);
    await page.getByTestId("expense-amount").fill("1200");
    await page.getByTestId("expense-save").click();

    const row = page.getByTestId("expense-list").locator("li").filter({ hasText: SUB });
    await expect(row).toContainText("DRAFT");

    // 2 · Approve it (AC-4)
    await row.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByTestId("expense-list").locator("li").filter({ hasText: SUB })).toContainText("APPROVED");

    // 3 · It now counts toward today's rollup (AC-5)
    await expect(page.getByTestId("today-total")).toContainText("₹1,200");
  });
});
