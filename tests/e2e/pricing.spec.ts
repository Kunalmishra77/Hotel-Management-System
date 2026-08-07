/**
 * 24 T-10 — pricing journey (AC-1/3/4): a SUGGESTED rate on an in-window date is
 * approved by a manager, and the row becomes APPROVED with the approved rate —
 * i.e. resolvable for that date (getResolvedRate reads APPROVED rows). Mobile
 * viewport; RBAC + guardrail enforced server-side.
 */
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const MANAGER = { email: "manager.mg@woodpecker.example", password: "woodpecker-dev-2026" };
const PROP_A_ID = "prop_wmg";
const CAT_DLX_ID = "cat_wmg_deluxe";

// A date inside the /pricing 14-day rolling window (today + 3).
const target = new Date();
target.setUTCDate(target.getUTCDate() + 3);
const DAY = target.toISOString().slice(0, 10);
const DAY_DATE = new Date(`${DAY}T00:00:00.000Z`);

let rateId = "";

test.beforeAll(async () => {
  const prisma = new PrismaClient();
  try {
    // Idempotent: clear any prior row for this (category, date), then seed SUGGESTED.
    await prisma.dynamicRate.deleteMany({ where: { roomCategoryId: CAT_DLX_ID, date: DAY_DATE } });
    const row = await prisma.dynamicRate.create({
      data: {
        propertyId: PROP_A_ID,
        roomCategoryId: CAT_DLX_ID,
        date: DAY_DATE,
        suggestedPaise: 690_000, // ₹6,900, within the ₹8,000 ceil
        status: "SUGGESTED",
        reason: "e2e seed",
      },
      select: { id: true },
    });
    rateId = row.id;
  } finally {
    await prisma.$disconnect();
  }
});

test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.dynamicRate.deleteMany({ where: { id: rateId } });
  } finally {
    await prisma.$disconnect();
  }
});

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe("pricing approval journey (T-10, AC-3/4)", () => {
  test("manager approves a suggested rate and it becomes APPROVED", async ({ page }) => {
    await signIn(page, MANAGER);
    await page.goto(`/pricing?cat=${CAT_DLX_ID}`);

    const row = page.getByTestId(`rate-${DAY}`);
    await expect(row).toBeVisible();

    await page.getByTestId(`rate-input-${DAY}`).fill("6500");
    await page.getByTestId(`rate-approve-${DAY}`).click();

    // After refresh the row is APPROVED and the approve control is gone.
    await expect(page.getByTestId(`rate-status-${DAY}`)).toHaveText(/APPROVED/, { timeout: 10_000 });
    await expect(page.getByTestId(`rate-approve-${DAY}`)).toHaveCount(0);
  });
});
