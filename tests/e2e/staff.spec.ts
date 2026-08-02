/**
 * 09-staff T-14 — add staff → masked list → record attendance (AC-1/4/5), mobile
 * viewport. Manager holds staff:manage (2FA off).
 */
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const MANAGER = { email: "manager.mg@woodpecker.example", password: "woodpecker-dev-2026" };
const NAME = `E2EStaff-${Date.now()}`;

test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    const staff = await prisma.staff.findMany({ where: { name: { startsWith: "E2EStaff-" } }, select: { id: true } });
    const ids = staff.map((s) => s.id);
    if (ids.length) {
      await prisma.attendance.deleteMany({ where: { staffId: { in: ids } } });
      await prisma.staff.deleteMany({ where: { id: { in: ids } } });
    }
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

test.describe("staff journey — add → masked list → attendance (T-14)", () => {
  test("a manager adds staff and records a day", async ({ page }) => {
    await signIn(page);
    await page.goto("/staff");

    // 1 · Add a staff member with an Aadhaar (AC-1)
    await page.getByTestId("staff-name").fill(NAME);
    await page.getByTestId("staff-mobile").fill("9811112222");
    await page.getByTestId("staff-salary").fill("31000");
    await page.getByTestId("staff-aadhaar").fill("1234 5678 9012");
    await page.getByTestId("staff-save").click();

    // 2 · Appears in the list, MASKED (AC-4)
    const row = page.getByTestId("staff-list").locator("li").filter({ hasText: NAME });
    await expect(row).toContainText("XXXXXX2222");
    await expect(row).toContainText("XXXX XXXX 9012");

    // 3 · Record attendance for today (AC-5)
    await row.getByRole("button", { name: "Mark present" }).click();
    await expect(page.getByTestId("attendance-note")).toContainText("present today");

    // 4 · The attendance row was written with 510 worked minutes.
    const prisma = new PrismaClient();
    try {
      const staff = await prisma.staff.findFirstOrThrow({ where: { name: NAME }, select: { id: true } });
      const att = await prisma.attendance.findFirstOrThrow({ where: { staffId: staff.id }, select: { workedMinutes: true } });
      expect(att.workedMinutes).toBe(510);
    } finally {
      await prisma.$disconnect();
    }
  });
});
