/**
 * 18 T-13 — Ask-PMS journey on a mobile viewport (AC-4/11).
 *  - Manager opens Ask PMS, runs a natural-language search ("guests from
 *    Bangalore"), and gets masked result cards — the compiled query runs through
 *    15's allow-list, never raw SQL, and the raw mobile never reaches the page.
 *
 * The sentiment write-back path (AC-6) is verified in tests/integration/ai.test.ts
 * because feedback capture is owned by module 12 (no 18 UI surface for it).
 */
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { encryptString, keyedHash } from "../../src/lib/crypto/encryption";

const MANAGER = { email: "manager.mg@woodpecker.example", password: "woodpecker-dev-2026" };
const ORG_ID = "org_woodpecker";
const GID = "ai_e2e_guest";
const MOBILE = "9876500022";

test.beforeAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.guest.upsert({
      where: { id: GID },
      create: { id: GID, orgId: ORG_ID, fullName: "Ask PMS Guest", mobile: encryptString(MOBILE), mobileHash: keyedHash(MOBILE), city: "Bangalore", state: "Karnataka" },
      update: { deletedAt: null, city: "Bangalore" },
    });
  } finally {
    await prisma.$disconnect();
  }
});

test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.guest.deleteMany({ where: { id: GID } });
  } finally {
    await prisma.$disconnect();
  }
});

test.describe("Ask PMS (T-13)", () => {
  test("manager runs an NL search and sees masked result cards (AC-4)", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(MANAGER.email);
    await page.getByLabel("Password", { exact: true }).fill(MANAGER.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto("/ai");
    await expect(page.getByTestId("ask-input")).toBeVisible();
    await page.getByTestId("ask-input").fill("guests from Bangalore");
    await page.getByTestId("ask-submit").click();

    const card = page.getByTestId("ask-result-guest").first();
    await expect(card).toBeVisible();
    // Masked: the raw mobile is never rendered.
    await expect(page.locator("body")).not.toContainText(MOBILE);
  });
});
