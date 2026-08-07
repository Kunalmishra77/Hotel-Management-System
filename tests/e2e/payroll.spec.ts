/**
 * 21-payroll T-20 — generate → adjust a line → finalize → payslip downloadable,
 * on a mobile viewport. Manager holds payroll:run (2FA off). Uses a per-run
 * far-future month so reruns never collide with the finalized `(prop, month,
 * sequence)` key; the seeded staff (joined ≤2026) are employed in any later month.
 */
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const MANAGER = { email: "manager.mg@woodpecker.example", password: "woodpecker-dev-2026" };
const PROP_A_ID = "prop_wmg";

const SLOT = Math.floor(Date.now() / 60_000) % 10_800;
const YEAR = 2100 + Math.floor(SLOT / 12);
const MON = (SLOT % 12) + 1;
const MONTH = `${YEAR}-${String(MON).padStart(2, "0")}`;
const STAFF_ID = `pay_e2e_staff_${SLOT}`;

test.beforeAll(async () => {
  // Self-seed an eligible staff member at PROP-A (joined well before the run
  // month) so generateRun produces a line — the base seed carries no persistent
  // staff, and seedPayroll is only wired into the seed runner.
  const prisma = new PrismaClient();
  try {
    await prisma.staff.upsert({
      where: { id: STAFF_ID },
      create: { id: STAFF_ID, propertyId: PROP_A_ID, name: "Payroll E2E Staff", mobile: "9800109999", department: "Front Office", monthlySalaryPaise: 3_000_000, joinedOn: new Date("2099-01-01"), isActive: true },
      update: { isActive: true, deletedAt: null, leftOn: null },
    });
  } finally {
    await prisma.$disconnect();
  }
});

test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    const runs = await prisma.payrollRun.findMany({ where: { month: MONTH }, select: { id: true } });
    const ids = runs.map((r) => r.id);
    await prisma.payrollLine.deleteMany({ where: { runId: { in: ids } } });
    await prisma.payrollRun.deleteMany({ where: { id: { in: ids } } });
    await prisma.staff.deleteMany({ where: { id: STAFF_ID } });
  } finally {
    await prisma.$disconnect();
  }
});

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(MANAGER.email);
  await page.getByLabel("Password", { exact: true }).fill(MANAGER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe("payroll journey — generate → adjust → finalize → payslip (T-20)", () => {
  test("a manager runs payroll for a month and downloads a payslip", async ({ page }) => {
    await signIn(page);
    await page.goto("/payroll");

    // 1 · Generate the run (AC-1) → navigates to the run detail.
    await page.getByTestId("payroll-month").fill(MONTH);
    await page.getByTestId("payroll-generate").click();
    await expect(page).toHaveURL(/\/payroll\/[^/]+$/);
    await expect(page.getByTestId("run-status")).toHaveText("DRAFT");

    const firstLine = page.getByTestId("payroll-lines").locator("li").first();
    await expect(firstLine).toBeVisible();

    // 2 · Adjust a line (bonus) and save (AC-6).
    await firstLine.getByTestId(/^bonus-/).fill("1000");
    await firstLine.getByTestId(/^save-/).click();

    // 3 · Finalize the run (AC-8) → status FINALIZED.
    await page.getByTestId("finalize-run").click();
    await expect(page.getByTestId("run-status")).toHaveText("FINALIZED");

    // 4 · A payslip is downloadable for a finalized line (AC-8/14).
    const payslipLink = page.getByTestId(/^payslip-/).first();
    await expect(payslipLink).toBeVisible();
    const download = page.waitForEvent("download");
    await payslipLink.click();
    const file = await download;
    expect(file.suggestedFilename()).toContain(".pdf");
  });
});
