/**
 * 04-guest-crm T-21 — journey on a mobile viewport.
 *
 * tasks.md: "Journey: create → dedupe prompt → add Aadhaar (masked) → search →
 * reveal-with-reason (audited). (AC-1/3/5/7/8)"
 *
 * Everything the guest sees is masked; the one place a raw value appears is the
 * reveal sheet, after a reason — and this test asserts that reveal wrote an
 * audit row, because "it showed the number" is only half the requirement.
 */
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const RECEPTION = { email: "reception.mg@woodpecker.example", password: "woodpecker-dev-2026" };

/** Everything this suite creates carries this name prefix, so cleanup is exact. */
const E2E_PREFIX = "E2EGuest";
const SEEDED_RAVI_MOBILE = "9800000001"; // G-RAVI — collides to trigger the dedupe prompt

function uniqueSuffix(): string {
  return Date.now().toString(36).slice(-4).toUpperCase();
}

test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    const created = await prisma.guest.findMany({
      where: { fullName: { startsWith: E2E_PREFIX } },
      select: { id: true },
    });
    const ids = created.map((g) => g.id);
    if (ids.length) {
      await prisma.guestId.deleteMany({ where: { guestId: { in: ids } } });
      await prisma.guest.deleteMany({ where: { id: { in: ids } } });
    }
  } finally {
    await prisma.$disconnect();
  }
});

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe("journey — create → dedupe → add Aadhaar → search → reveal (T-21)", () => {
  test("reception completes the whole guest flow", async ({ page }) => {
    const name = `${E2E_PREFIX} ${uniqueSuffix()}`;
    await signIn(page, RECEPTION);

    // 1 · New guest with a number that already exists → dedupe prompt (AC-3)
    await page.goto("/guests/new");
    await page.getByLabel("Full name").fill(name);
    await page.getByLabel("Mobile").fill(SEEDED_RAVI_MOBILE);
    await page.getByTestId("create-guest-submit").click();

    const sheet = page.getByTestId("duplicate-sheet");
    await expect(sheet).toBeVisible();
    // The candidate is shown MASKED — the prompt is not a PII side-channel (AC-7).
    await expect(page.getByTestId("duplicate-candidate").first()).toContainText("XXXXXX0001");

    // 2 · Create anyway → lands on the new profile (FR-5)
    await page.getByTestId("create-anyway").click();
    await expect(page).toHaveURL(/\/guests\/[a-z0-9]+$/);
    await expect(page.getByTestId("guest-name")).toHaveText(name);

    // 3 · Contact is masked by default (AC-7)
    await expect(page.getByTestId("masked-mobile")).toHaveText("XXXXXX0001");

    // 4 · Add an Aadhaar → stored + shown as last-4 only (AC-5)
    await page.getByLabel("Type").selectOption("AADHAAR");
    await page.getByTestId("add-id-value").fill("1234 5678 9012");
    await page.getByTestId("add-id-submit").click();
    await expect(page.getByTestId("masked-id").first()).toHaveText(/XXXX XXXX 9012/);

    // 5 · Reveal the mobile — reason required, value shown once (AC-8)
    await page.getByTestId("reveal-mobile").click();
    await expect(page.getByTestId("reveal-sheet")).toBeVisible();
    // The confirm is disabled until a reason is given.
    await expect(page.getByTestId("reveal-confirm")).toBeDisabled();
    await page.getByTestId("reveal-reason").fill("Returning a lost item");
    await page.getByTestId("reveal-confirm").click();
    await expect(page.getByTestId("revealed-value")).toHaveText(SEEDED_RAVI_MOBILE);

    // 6 · The reveal was AUDITED (AC-8) — the point of the whole gate.
    const prisma = new PrismaClient();
    try {
      const audit = await prisma.auditLog.findFirst({
        where: { action: "guest:reveal-pii", reason: "Returning a lost item" },
        orderBy: { createdAt: "desc" },
      });
      expect(audit).not.toBeNull();
      // The value must never be in the audit row.
      expect(JSON.stringify(audit?.after ?? {})).not.toContain(SEEDED_RAVI_MOBILE);
    } finally {
      await prisma.$disconnect();
    }

    // 7 · Search finds the guest, masked (AC-7)
    await page.goto("/guests");
    await page.getByTestId("guest-search-input").fill(name);
    await expect(page.getByTestId("guest-row").first()).toContainText(name);
  });
});
