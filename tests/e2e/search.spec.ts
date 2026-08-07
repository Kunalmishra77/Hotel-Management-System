/**
 * 15 T-11 — search & export journey on a mobile viewport (AC-1/4/5/7).
 *  - Reception searches by mobile → opens the guest; the export menu is hidden
 *    (reception lacks export:data per the RBAC matrix — the spec's "masked for
 *    reception" is enforced as no-export-at-all here; PII masking on the card is
 *    covered too).
 *  - Manager searches → exports to Excel → a file downloads.
 */
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { encryptString, keyedHash } from "../../src/lib/crypto/encryption";

const RECEPTION = { email: "reception.mg@woodpecker.example", password: "woodpecker-dev-2026" };
const MANAGER = { email: "manager.mg@woodpecker.example", password: "woodpecker-dev-2026" };
const ORG_ID = "org_woodpecker";
const GID = "srch_e2e_guest";
const MOBILE = "9876500011";

test.beforeAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.guest.upsert({
      where: { id: GID },
      create: { id: GID, orgId: ORG_ID, fullName: "Journey Guest", mobile: encryptString(MOBILE), mobileHash: keyedHash(MOBILE), city: "Testport" },
      update: { deletedAt: null, mobile: encryptString(MOBILE), mobileHash: keyedHash(MOBILE) },
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

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe("search & export (T-11)", () => {
  test("reception searches by mobile, opens the guest; no export menu", async ({ page }) => {
    await signIn(page, RECEPTION);
    await page.goto("/search");
    await page.getByTestId("global-search-input").fill(MOBILE);
    const card = page.getByTestId("result-guest").first();
    await expect(card).toBeVisible();
    await expect(page.getByTestId("export-menu")).toHaveCount(0); // reception cannot export (AC-7)
    await card.click();
    await expect(page).toHaveURL(new RegExp(`/guests/${GID}`));
  });

  test("manager exports search results to Excel (AC-4)", async ({ page }) => {
    await signIn(page, MANAGER);
    await page.goto(`/search?q=${MOBILE}`);
    await expect(page.getByTestId("result-guest").first()).toBeVisible();
    await expect(page.getByTestId("export-menu")).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("export-xlsx").click(),
    ]);
    expect(download.suggestedFilename()).toContain(".xlsx");
  });
});
