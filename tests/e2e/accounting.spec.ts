/**
 * 22 accounting-sync T-11 — the sandbox journey on a mobile viewport.
 *
 * Per the module test plan: drive the SYNC assertions via the DB (issue invoice →
 * sync logged → re-deliver → no duplicate — AC-1/3), and use the UI only for the
 * reconciliation view (AC-7) + the server-side RBAC gate (AC-12). Admin has
 * enforced 2FA, so the sign-in completes the TOTP step with the seeded secret
 * (as tests/e2e/platform.spec.ts does).
 *
 * Runs against the seeded fixtures; `npm run db:seed` must have been applied.
 */
import { expect, test, type Page } from "@playwright/test";
import { authenticator } from "otplib";
import { PrismaClient } from "@prisma/client";
import { DEV_PASSWORD, ORG_ID, PROP_A_ID, USER_ACCOUNTS_TOTP_SECRET } from "../../prisma/seed/fixtures";

const prisma = new PrismaClient();

const SLOT = `${Date.now()}`;
const PROVIDER = `e2e_zoho_${SLOT}`;
const INV_ID = `e2e_inv_${SLOT}`;
let folioId = "";

const ADMIN = { email: "admin@woodpecker.example", password: DEV_PASSWORD };
const RECEPTION = { email: "reception.mg@woodpecker.example", password: DEV_PASSWORD };

test.beforeAll(async () => {
  await prisma.accountingConfig.upsert({
    where: { orgId_provider: { orgId: ORG_ID, provider: PROVIDER } },
    create: { orgId: ORG_ID, provider: PROVIDER, mode: "sandbox" },
    update: { mode: "sandbox" },
  });
  const folio = await prisma.folio.create({ data: { propertyId: PROP_A_ID, kind: "DIRECT_SALE" }, select: { id: true } });
  folioId = folio.id;
  await prisma.invoice.create({
    data: {
      id: INV_ID, propertyId: PROP_A_ID, folioId, number: `E2E/${SLOT}/1`, financialYear: "2026-27",
      type: "TAX_INVOICE", customerName: "E2E Guest", placeOfSupply: "29-Karnataka",
      taxableValuePaise: 1_200_000n, totalPaise: 1_341_000n,
    },
  });
  // "issue invoice → sync logged" (sandbox): a SANDBOX row with a mock externalId.
  await prisma.accountingSyncLog.create({
    data: { provider: PROVIDER, entityType: "Invoice", entityId: INV_ID, status: "SANDBOX", externalId: `mock-${PROVIDER}-invoice-${SLOT}` },
  });
});

test.afterAll(async () => {
  await prisma.accountingSyncLog.deleteMany({ where: { provider: PROVIDER } });
  await prisma.accountingConfig.deleteMany({ where: { orgId: ORG_ID, provider: PROVIDER } });
  // Invoice is append-only (Folio is FK-restricted by it) — both persist; INV_ID
  // is per-run-unique (SLOT) so there is no re-run collision.
  await prisma.$disconnect();
});

test.describe("sandbox sync is idempotent (AC-1/3)", () => {
  test("a re-delivered sync creates no duplicate row (unique key)", async () => {
    // Re-delivery: re-logging the same (provider, entityType, entityId) is rejected
    // by the unique constraint — the accounting system never gets a duplicate.
    await expect(
      prisma.accountingSyncLog.create({
        data: { provider: PROVIDER, entityType: "Invoice", entityId: INV_ID, status: "SANDBOX", externalId: "dupe" },
      }),
    ).rejects.toThrow();

    const rows = await prisma.accountingSyncLog.findMany({ where: { provider: PROVIDER, entityType: "Invoice", entityId: INV_ID } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("SANDBOX");
    expect(rows[0]!.externalId?.startsWith("mock-")).toBe(true);
  });
});

async function signInAdmin(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Code").fill(authenticator.generate(USER_ACCOUNTS_TOTP_SECRET));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe("reconciliation UI + RBAC (AC-7/12)", () => {
  test("an admin sees the provider on the accounting page", async ({ page }) => {
    await signInAdmin(page);
    await page.goto("/accounting");
    await expect(page.getByRole("heading", { name: "Accounting sync" })).toBeVisible();
    await expect(page.getByTestId(`provider-${PROVIDER}`)).toBeVisible();
  });

  test("reception is refused the accounting page server-side (403)", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(RECEPTION.email);
    await page.getByLabel("Password", { exact: true }).fill(RECEPTION.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    const res = await page.goto("/accounting");
    expect(res?.status()).toBe(403);
  });
});
