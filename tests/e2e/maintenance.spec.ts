/**
 * 11-maintenance T-12 — job lifecycle create → start → close-with-cost (AC-1/4),
 * mobile viewport. Maintenance role (2FA off). The block→unavailable→restore path
 * (AC-3/8) is covered exhaustively by the integration suite.
 */
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const MNT = { email: "maintenance.mg@woodpecker.example", password: "woodpecker-dev-2026" };
const DESC = `E2EJob-${Date.now()}`;

test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.maintenanceJob.deleteMany({ where: { description: { startsWith: "E2EJob-" } } });
  } finally {
    await prisma.$disconnect();
  }
});

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(MNT.email);
  await page.getByLabel("Password").fill(MNT.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe("maintenance journey — create → start → close (T-12)", () => {
  test("maintenance works a job to closed with a cost", async ({ page }) => {
    await signIn(page);
    await page.goto("/maintenance");

    // 1 · Create a job (AC-1)
    await page.getByTestId("job-category").selectOption("ELECTRICAL");
    await page.getByTestId("job-description").fill(DESC);
    await page.getByTestId("job-save").click();

    const row = page.getByTestId("job-list").locator("li").filter({ hasText: DESC });
    await expect(row).toContainText("OPEN");

    // 2 · Start it
    await row.getByRole("button", { name: "Start" }).click();
    await expect(page.getByTestId("job-list").locator("li").filter({ hasText: DESC })).toContainText("IN_PROGRESS");

    // 3 · Close with a ₹1,500 cost (AC-4)
    const inProg = page.getByTestId("job-list").locator("li").filter({ hasText: DESC });
    await inProg.locator('input[type="number"]').fill("1500");
    await inProg.getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("job-list").locator("li").filter({ hasText: DESC })).toContainText("CLOSED");

    // 4 · Verify the close + cost in-DB.
    const prisma = new PrismaClient();
    try {
      const job = await prisma.maintenanceJob.findFirstOrThrow({ where: { description: DESC } });
      expect(job.status).toBe("CLOSED");
      expect(job.closedAt).not.toBeNull();
      expect(job.costPaise).toBe(150_000);
    } finally {
      await prisma.$disconnect();
    }
  });
});
