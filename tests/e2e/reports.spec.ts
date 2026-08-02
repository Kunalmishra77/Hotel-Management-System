/**
 * 08-profit-reports T-9 — profit report renders for a financial role; a
 * non-financial role is refused (AC-1/7), mobile viewport.
 */
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const MANAGER = { email: "manager.mg@woodpecker.example", password: "woodpecker-dev-2026" };
const HK = { email: "housekeeping.mg@woodpecker.example", password: "woodpecker-dev-2026" };
const PROP_A_ID = "prop_wmg";
const month = new Date().toISOString().slice(0, 7);
const cleanup = { expenseId: "", payrollId: "" };

test.beforeAll(async () => {
  const prisma = new PrismaClient();
  try {
    const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
    const folio = await prisma.folio.create({ data: { propertyId: PROP_A_ID, kind: "DIRECT_SALE" }, select: { id: true } });
    await prisma.folioLine.create({ data: { folioId: folio.id, type: "ROOM", description: "Rpt", quantity: 1, unitPaise: 400_000, amountPaise: 400_000n, businessDate: today } });
    const e = await prisma.expense.create({ data: { propertyId: PROP_A_ID, head: "UTILITIES", amountPaise: 100_000, spentOn: today, status: "APPROVED" }, select: { id: true } });
    const p = await prisma.payrollRun.create({ data: { propertyId: PROP_A_ID, month, netTotalPaise: 200_000n, status: "FINALIZED", finalizedAt: new Date() }, select: { id: true } });
    cleanup.expenseId = e.id; cleanup.payrollId = p.id;
  } finally {
    await prisma.$disconnect();
  }
});

test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.expense.deleteMany({ where: { id: cleanup.expenseId } });
    await prisma.payrollRun.deleteMany({ where: { id: cleanup.payrollId } });
  } finally {
    await prisma.$disconnect();
  }
});

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe("profit report (T-9, AC-1/7)", () => {
  test("a manager sees the profit breakdown + metrics", async ({ page }) => {
    await signIn(page, MANAGER);
    await page.goto("/reports");
    await expect(page.getByTestId("profit-report")).toBeVisible();
    await expect(page.getByTestId("report-revenue")).toBeVisible();
    await expect(page.getByTestId("report-profit")).toBeVisible();
  });

  test("housekeeping (no report:view-financial) is refused (AC-7)", async ({ page }) => {
    await signIn(page, HK);
    await page.goto("/reports");
    await expect(page.getByTestId("profit-report")).toHaveCount(0); // forbidden boundary, not the report
  });
});
