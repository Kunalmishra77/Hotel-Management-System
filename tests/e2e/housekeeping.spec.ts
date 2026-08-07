/**
 * 10-housekeeping T-11 — task board → mark clean → room VACANT (AC-1/2), mobile
 * viewport. Housekeeping role (2FA off). The offline-queue path (AC-5/6) is
 * covered exhaustively by the integration suite (syncOfflineUpdates + conflict).
 */
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const HK = { email: "housekeeping.mg@woodpecker.example", password: "woodpecker-dev-2026" };
const PROP_A_ID = "prop_wmg";
const ROOM_101_ID = "room_wmg_101";

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

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(HK.email);
  await page.getByLabel("Password", { exact: true }).fill(HK.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe("housekeeping journey — task → clean → VACANT (T-11)", () => {
  test("housekeeping marks a room clean and it returns to availability", async ({ page }) => {
    await signIn(page);
    await page.goto("/housekeeping");

    // 1 · The cleaning task for R-101 is on the board (AC-1)
    const card = page.getByTestId("task-101");
    await expect(card).toBeVisible();
    await expect(card).toContainText("PENDING");

    // 2 · Mark it clean (AC-2)
    await page.getByTestId("clean-101").click();

    // 3 · The room returns to VACANT and the task is DONE (verified in-DB).
    await expect(page.getByTestId("task-101")).not.toContainText("PENDING");
    const prisma = new PrismaClient();
    try {
      expect((await prisma.room.findUniqueOrThrow({ where: { id: ROOM_101_ID } })).status).toBe("VACANT");
      const task = await prisma.housekeepingTask.findFirstOrThrow({ where: { roomId: ROOM_101_ID }, orderBy: { createdAt: "desc" } });
      expect(task.status).toBe("DONE");
    } finally {
      await prisma.$disconnect();
    }
  });
});
