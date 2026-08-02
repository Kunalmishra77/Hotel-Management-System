/**
 * 12 T-24 — Communications console journey on a mobile viewport.
 *  - Manager signs in, opens Communications, sees the Templates tab, switches to
 *    the Message log and sees a delivered message with its status — recipient
 *    address masked (FR-15). The full event→send→webhook path is asserted in
 *    tests/integration/communications.test.ts (no user-facing surface for it).
 */
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const MANAGER = { email: "manager.mg@woodpecker.example", password: "woodpecker-dev-2026" };
const ORG_ID = "org_woodpecker";
const PROP_A_ID = "prop_wmg";
const GUEST_RAVI_ID = "guest_ravi";
const TPL_KEY = "C12_E2E_CONF";
const LOG_ID = "c12_e2e_log";

test.beforeAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.messageTemplate.upsert({
      where: { orgId_key_channel_language: { orgId: ORG_ID, key: TPL_KEY, channel: "WHATSAPP", language: "en" } },
      create: { orgId: ORG_ID, key: TPL_KEY, channel: "WHATSAPP", language: "en", body: "Hi {{guestName}}", providerTemplateId: "hsm_e2e", isActive: true },
      update: { isActive: true },
    });
    await prisma.messageLog.upsert({
      where: { id: LOG_ID },
      create: { id: LOG_ID, propertyId: PROP_A_ID, guestId: GUEST_RAVI_ID, channel: "WHATSAPP", category: "BEFORE_ARRIVAL", templateKey: TPL_KEY, toAddress: "9800000001", status: "DELIVERED", providerRef: "mock-e2e" },
      update: { status: "DELIVERED" },
    });
  } finally {
    await prisma.$disconnect();
  }
});

test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.messageLog.deleteMany({ where: { id: LOG_ID } });
    await prisma.messageTemplate.deleteMany({ where: { orgId: ORG_ID, key: TPL_KEY } });
  } finally {
    await prisma.$disconnect();
  }
});

test.describe("Communications console (T-24)", () => {
  test("manager views templates and the message log", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(MANAGER.email);
    await page.getByLabel("Password").fill(MANAGER.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto("/communications");
    await expect(page.getByRole("heading", { name: "Communications" })).toBeVisible();
    await expect(page.getByTestId("template-list")).toContainText(TPL_KEY);

    await page.getByRole("tab", { name: "Message log" }).click();
    const log = page.getByTestId("message-log");
    await expect(log).toContainText("DELIVERED");
    // The raw stored number is never rendered (FR-15).
    await expect(page.locator("body")).not.toContainText("9800000001");
  });
});
