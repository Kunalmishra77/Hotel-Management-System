/**
 * 17 T-11 — offline housekeeping: queue while offline → flush on reconnect, with
 * both outcomes the durable IndexedDB queue must handle (FR-3/4/8, AC-4/5):
 *   1. a fresh write APPLIES on reconnect (room returns to VACANT),
 *   2. a STALE write is REJECTED as a conflict and surfaced, never applied.
 *
 * Runs against the production server (playwright.config webServer), so the real
 * service worker is active — proving the offline path end-to-end, not just in
 * integration. Housekeeping role, 2FA off, mobile viewport.
 */
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const HK = { email: "housekeeping.mg@woodpecker.example", password: "woodpecker-dev-2026" };
const PROP_A_ID = "prop_wmg";
const ROOM_101_ID = "room_wmg_101";

/** Reset R-101 to a single fresh PENDING cleaning task. `serverStatusChangedAt`
 *  defaults to null (nothing to be stale against) unless overridden. */
async function seedTask(serverStatusChangedAt: Date | null = null): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await prisma.housekeepingTask.deleteMany({ where: { roomId: ROOM_101_ID } });
    await prisma.room.update({ where: { id: ROOM_101_ID }, data: { status: "HOUSEKEEPING" } });
    await prisma.housekeepingTask.create({
      data: { propertyId: PROP_A_ID, roomId: ROOM_101_ID, type: "CLEANING", status: "PENDING", serverStatusChangedAt },
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function roomStatus(): Promise<string> {
  const prisma = new PrismaClient();
  try {
    return (await prisma.room.findUniqueOrThrow({ where: { id: ROOM_101_ID } })).status;
  } finally {
    await prisma.$disconnect();
  }
}

async function latestTaskStatus(): Promise<string> {
  const prisma = new PrismaClient();
  try {
    const t = await prisma.housekeepingTask.findFirstOrThrow({ where: { roomId: ROOM_101_ID }, orderBy: { createdAt: "desc" } });
    return t.status;
  } finally {
    await prisma.$disconnect();
  }
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(HK.email);
  await page.getByLabel("Password", { exact: true }).fill(HK.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Role landing varies (housekeeping lands on /housekeeping) — just confirm we
  // left the sign-in page, i.e. auth completed.
  await expect(page).not.toHaveURL(/\/sign-in/);
}

test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.housekeepingTask.deleteMany({ where: { roomId: ROOM_101_ID } });
    await prisma.room.update({ where: { id: ROOM_101_ID }, data: { status: "VACANT" } });
  } finally {
    await prisma.$disconnect();
  }
});

test.describe("offline housekeeping queue (17 T-11)", () => {
  test("queued offline, applies on reconnect", async ({ page, context }) => {
    await seedTask();
    await signIn(page);
    await page.goto("/housekeeping");
    await expect(page.getByTestId("task-101")).toContainText("PENDING");

    // Go offline: the mark-clean is queued locally, not sent.
    await context.setOffline(true);
    await expect(page.getByTestId("offline-banner")).toBeVisible();
    await page.getByTestId("clean-101").click();
    await expect(page.getByTestId("queued-101")).toBeVisible();

    // Back online: the queue flushes and the write applies.
    await context.setOffline(false);
    await expect(page.getByTestId("queued-101")).toBeHidden();
    await expect.poll(latestTaskStatus).toBe("DONE");
    expect(await roomStatus()).toBe("VACANT");
  });

  test("stale offline write is rejected as a conflict, not applied", async ({ page, context }) => {
    // The task's server clock is already ahead of anything the client will stamp,
    // so the queued write is stale the moment it is made.
    await seedTask(new Date(Date.now() + 3_600_000));
    await signIn(page);
    await page.goto("/housekeeping");
    await expect(page.getByTestId("task-101")).toContainText("PENDING");

    await context.setOffline(true);
    await page.getByTestId("clean-101").click();
    await expect(page.getByTestId("queued-101")).toBeVisible();

    await context.setOffline(false);
    // Surfaced as out-of-date, dropped from the queue, and NOT applied.
    await expect(page.getByTestId("hk-message")).toContainText("out of date");
    await expect(page.getByTestId("queued-101")).toBeHidden();
    expect(await latestTaskStatus()).toBe("PENDING");
    expect(await roomStatus()).toBe("HOUSEKEEPING");
  });
});
