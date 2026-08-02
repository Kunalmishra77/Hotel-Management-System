/**
 * 13 T-22 — Channels journey on a mobile viewport (AC-1/2/15).
 *  - Administrator signs in, opens Channels, connects a sandbox channel, maps an
 *    external room type → an internal category, and sees the channel in the
 *    health list showing its sandbox state.
 *
 * The worker-driven paths — mock pull → create via 03, inbox dedupe on
 * re-delivery, and the availability re-push to the outbox (AC-4/5/9) — need the
 * pg-boss worker and are asserted deterministically in
 * tests/integration/channels.test.ts.
 */
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { authenticator } from "otplib";

const ADMIN = { email: "admin@woodpecker.example", password: "woodpecker-dev-2026" };
// channels is integration:manage — ADMIN-only, and ADMIN has enforced+enrolled
// 2FA (seed), so sign-in requires the TOTP step (shared dev secret).
const ADMIN_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const PROP_A_ID = "prop_wmg";
const PROVIDER = "test13_e2e";

test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    const accounts = await prisma.channelAccount.findMany({ where: { propertyId: PROP_A_ID, provider: PROVIDER }, select: { id: true } });
    const ids = accounts.map((a) => a.id);
    await prisma.channelSyncLog.deleteMany({ where: { channelAccountId: { in: ids } } });
    await prisma.roomTypeMapping.deleteMany({ where: { channelAccountId: { in: ids } } });
    await prisma.channelAccount.deleteMany({ where: { id: { in: ids } } });
  } finally {
    await prisma.$disconnect();
  }
});

test.describe("Channels console (T-22)", () => {
  test("admin connects a sandbox channel and maps a room type", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByLabel("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    // ADMIN has enforced 2FA — complete the challenge with the shared dev secret.
    await expect(page.getByRole("heading", { name: "Two-factor code" })).toBeVisible();
    await page.getByLabel(/code/i).fill(authenticator.generate(ADMIN_TOTP_SECRET));
    await page.getByRole("button", { name: /verify|continue|sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto("/channels");
    await expect(page.getByRole("heading", { name: "Channels" })).toBeVisible();

    // Connect (sandbox) — AC-1.
    await page.getByTestId("connect-provider").fill(PROVIDER);
    await page.getByTestId("connect-submit").click();

    // The channel appears in the health list, sandbox state — AC-15.
    const card = page.getByTestId(`channel-${PROVIDER}`);
    await expect(card).toBeVisible();
    await expect(page.getByTestId(`state-${PROVIDER}`)).toContainText("sandbox");

    // Live is gated until certified — AC-3.
    await expect(page.getByTestId(`activate-${PROVIDER}`)).toContainText("needs certification");

    // Map an external room type → internal category — AC-2.
    const account = card;
    const externalInput = account.getByTestId(/^map-external-/);
    await externalInput.fill("DLX-BB");
    await account.getByTestId(/^map-submit-/).click();
    await expect(account.getByTestId("mapping-DLX-BB")).toBeVisible();
  });
});
