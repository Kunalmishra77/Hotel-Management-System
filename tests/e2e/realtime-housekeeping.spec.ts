/**
 * 17 T-12 — two-device realtime. Two independent sessions on the same property:
 * device A completes a cleaning task; device B, which only has the board open and
 * does nothing, sees it update live via SSE (RoomStatusChanged / HousekeepingTaskDone
 * on the broadcast allow-list). Proves the live board wiring from 17C end-to-end.
 *
 * The <2s latency budget (AC-6) is a production-colocated figure; here we assert
 * the update lands within the standard e2e timeout over a laptop→managed-DB hop,
 * same rationale as the sign-in budget note in playwright.config.
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

async function signInTo(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(HK.email);
  await page.getByLabel("Password", { exact: true }).fill(HK.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
  await page.goto("/housekeeping");
}

test("a cleaning completed on one device updates the other's board live (17 T-12)", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    const [pageA, pageB] = [await ctxA.newPage(), await ctxB.newPage()];
    await signInTo(pageA);
    await signInTo(pageB);

    // Both see the pending task; B will not touch it.
    await expect(pageA.getByTestId("clean-101")).toBeVisible();
    await expect(pageB.getByTestId("clean-101")).toBeVisible();

    // Device A completes the clean.
    await pageA.getByTestId("clean-101").click();
    await expect(pageA.getByTestId("clean-101")).toBeHidden();

    // Device B refreshes live (SSE nudge → re-query) — the action button is gone
    // without B doing anything.
    await expect(pageB.getByTestId("clean-101")).toBeHidden();
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
