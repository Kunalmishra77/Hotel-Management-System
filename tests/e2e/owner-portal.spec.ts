/**
 * 27 owner-portal — e2e (T-22). Owner signs in and reaches ONLY their surfaces
 * (financials, documents, schedule, payouts), and can open a payout statement PDF.
 * Owner `owner.mg@woodpecker.example` is 2FA-off, scoped to PROP-A.
 *
 * A payout row is seeded directly (the statement PDF renders on-demand from the
 * immutable snapshot — no object storage needed), then cleaned up.
 */
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const PW = "woodpecker-dev-2026";
const OWNER = "owner.mg@woodpecker.example";
const PROP_A_ID = "prop_wmg";
const PERIOD = new Date(Date.UTC(2023, 0, 1)); // distinctive test month

test.beforeAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.ownerPayout.deleteMany({ where: { propertyId: PROP_A_ID, periodMonth: PERIOD } });
    await prisma.ownerPayout.create({
      data: {
        propertyId: PROP_A_ID,
        periodMonth: PERIOD,
        grossRevenuePaise: 50_000_000n,
        expensePaise: 18_000_000n,
        managementFeeBps: 1500,
        managementFeePaise: 7_500_000n,
        netPayablePaise: 24_500_000n,
        status: "COMPUTED",
        recordedById: "user_admin",
      },
    });
  } finally {
    await prisma.$disconnect();
  }
});

test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.ownerPayout.deleteMany({ where: { propertyId: PROP_A_ID, periodMonth: PERIOD } });
  } finally {
    await prisma.$disconnect();
  }
});

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

test("owner sees only their surfaces, financials, and a payout statement (T-22)", async ({ page }) => {
  await signIn(page, OWNER);

  // Owner home — financials render (KPIs).
  await page.goto("/owner");
  await expect(page.getByTestId("owner-kpis")).toBeVisible();

  // Nav is permission-filtered to owner surfaces only (AC-1) — no bookings/guests.
  await expect(page.getByRole("link", { name: "Owner portal" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Bookings" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Guests" })).toHaveCount(0);

  // Documents surface loads (owner can upload their own).
  await page.goto("/owner/documents");
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();

  // Schedule surface loads.
  await page.goto("/owner/schedule");
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();

  // Payouts — the seeded statement is listed and downloadable as a PDF.
  await page.goto("/owner/payouts");
  const list = page.getByTestId("payout-list");
  await expect(list).toBeVisible();
  await expect(list.getByText("2023-01")).toBeVisible();

  const dl = page.getByTestId("payout-download").first();
  const href = await dl.getAttribute("href");
  expect(href).toBeTruthy();
  const res = await page.request.get(href!);
  expect(res.ok()).toBeTruthy();
  expect(res.headers()["content-type"]).toContain("application/pdf");
});

test("owner cannot reach a non-owner surface (bookings)", async ({ page }) => {
  await signIn(page, OWNER);
  await page.goto("/bookings");
  // requirePermission denies — owner lands anywhere but the bookings board.
  await expect(page.getByRole("heading", { name: "Bookings", exact: true })).toHaveCount(0);
});
