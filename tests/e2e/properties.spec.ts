/**
 * 01-property-management T-16 — journey on a mobile viewport.
 *
 * tasks.md: "Journey: admin creates property → adds floors → sees it in
 * overview. (AC-1/4/6)"
 *
 * Runs against the seeded fixtures; `npm run db:seed` must have been applied.
 */
import { expect, test, type Page } from "@playwright/test";
import { authenticator } from "otplib";
import { PrismaClient } from "@prisma/client";

const ADMIN = { email: "admin@woodpecker.example", password: "woodpecker-dev-2026" };
const MANAGER = { email: "manager.mg@woodpecker.example", password: "woodpecker-dev-2026" };
/** U-ADMIN and U-ACC share the fixture secret (prisma/seed/fixtures.ts). */
const TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

/**
 * Unique per run so repeat runs never collide on the unique (orgId, code).
 * The `Z` prefix is also the cleanup key — see the afterAll below.
 */
const E2E_CODE_PREFIX = "Z";

function uniqueCode(): string {
  return `${E2E_CODE_PREFIX}${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

/**
 * Remove every property this suite created.
 *
 * These tests write REAL rows through the UI, and a leftover property breaks
 * assertions in other files that state the org contains exactly PROP-A and
 * PROP-B — which is exactly what happened before this hook existed. An e2e test
 * that persists data must clean up as rigorously as an integration test.
 */
test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    const created = await prisma.property.findMany({
      where: { code: { startsWith: E2E_CODE_PREFIX } },
      select: { id: true },
    });
    if (created.length === 0) return;
    const ids = created.map((p) => p.id);
    await prisma.floor.deleteMany({ where: { propertyId: { in: ids } } });
    await prisma.property.deleteMany({ where: { id: { in: ids } } });
  } finally {
    await prisma.$disconnect();
  }
});

async function signIn(page: Page, who: { email: string; password: string }, totp = false) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  if (totp) {
    await expect(page.getByRole("heading", { name: "Two-factor code" })).toBeVisible();
    await page.getByLabel("Code").fill(authenticator.generate(TOTP_SECRET));
    await page.getByRole("button", { name: "Verify" }).click();
  }
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe("property overview (AC-6 / AC-8)", () => {
  test("shows ROOMS-A rolled up to the occupancy AC-6 specifies", async ({ page }) => {
    await signIn(page, MANAGER);
    await page.goto("/properties");

    const tile = page.getByTestId("property-tile-WMG");
    await expect(tile).toBeVisible();
    // 3 occupied ÷ (10 − 1 maintenance) = 33%
    await expect(tile).toContainText("33%");
    await expect(tile).toContainText("10 rms");
    await expect(tile).toContainText("3 occ");
    await expect(tile).toContainText("1 maint");
  });

  test("labels the figure as current-status occupancy (reporting.md)", async ({ page }) => {
    // The rule is explicit that this must not be read as the ADR/RevPAR
    // denominator, so the label is part of the requirement, not decoration.
    await signIn(page, MANAGER);
    await page.goto("/properties");
    await expect(page.getByTestId("property-tile-WMG")).toContainText(
      "current-status occupancy",
    );
  });

  test("shows a scoped Manager only their own property (AC-8)", async ({ page }) => {
    await signIn(page, MANAGER);
    await page.goto("/properties");

    await expect(page.getByText("1 property in your scope")).toBeVisible();
    await expect(page.getByTestId("property-tile-WMG")).toBeVisible();
    await expect(page.getByTestId("property-tile-WWF")).toHaveCount(0);
  });

  test("offers no Add button to a Manager (AC-9)", async ({ page }) => {
    await signIn(page, MANAGER);
    await page.goto("/properties");
    await expect(page.getByRole("link", { name: "Add" })).toHaveCount(0);
  });
});

test.describe("server-side denial of property creation (AC-9)", () => {
  test("a Manager typing /properties/new gets 403", async ({ page }) => {
    await signIn(page, MANAGER);
    // Creating a property is org-scoped; hiding the button is not the guard.
    const response = await page.goto("/properties/new");
    expect(response?.status()).toBe(403);
    await expect(page.getByRole("heading", { name: "Not permitted" })).toBeVisible();
  });
});

test.describe("journey — create property → add floors → see it in overview (T-16)", () => {
  test("an administrator completes the whole flow", async ({ page }) => {
    const code = uniqueCode();
    const name = `E2E ${code} Residency`;

    await signIn(page, ADMIN, true);

    // 1 · Create (AC-1)
    await page.goto("/properties");
    await page.getByRole("link", { name: "Add" }).click();
    await expect(page).toHaveURL(/\/properties\/new/);

    await page.getByLabel("Property name").fill(name);
    await page.getByLabel("Code", { exact: true }).fill(code);
    await page.getByLabel("Address line 1").fill("42 Residency Road");
    await page.getByLabel("City").fill("Bengaluru");
    await page.getByLabel("State").fill("Karnataka");
    await page.getByLabel("PIN code").fill("560025");
    await page.getByLabel("GSTIN").fill("29ABCDE1234F1ZW"); // valid check digit (AC-3)
    await page.getByRole("button", { name: "Create property" }).click();

    // Lands on the new property's detail page.
    await expect(page).toHaveURL(/\/properties\/[^/]+$/);
    await expect(page.getByRole("heading", { name })).toBeVisible();

    // 2 · Add floors (AC-4)
    for (const floor of ["Ground", "1", "2"]) {
      await page.getByLabel("Add a floor").fill(floor);
      await page.getByRole("button", { name: "Add floor" }).click();
      await expect(page.getByTestId(`floor-${floor}`)).toBeVisible();
    }

    // A duplicate is rejected (AC-4).
    await page.getByLabel("Add a floor").fill("1");
    await page.getByRole("button", { name: "Add floor" }).click();
    // Scoped to the floor form's own alert: Next injects
    // #__next-route-announcer__ with role="alert" too, so a bare
    // getByRole("alert") matches two elements and trips strict mode.
    await expect(page.locator("#floor-error")).toContainText(/already exists/i);
    await expect(page.getByTestId("floor-1")).toHaveCount(1);

    // 3 · Appears in the overview (AC-6). No rooms yet ⇒ 0%, not NaN.
    await page.goto("/properties");
    const tile = page.getByTestId(`property-tile-${code}`);
    await expect(tile).toBeVisible();
    await expect(tile).toContainText(name);
    await expect(tile).toContainText("0%");
  });

  test("rejects a duplicate code with a field error (AC-2)", async ({ page }) => {
    await signIn(page, ADMIN, true);
    await page.goto("/properties/new");

    await page.getByLabel("Property name").fill("Impostor");
    await page.getByLabel("Code", { exact: true }).fill("WMG"); // already taken by PROP-A
    await page.getByLabel("Address line 1").fill("1 Road");
    await page.getByLabel("City").fill("Bengaluru");
    await page.getByLabel("State").fill("Karnataka");
    await page.getByLabel("PIN code").fill("560001");
    await page.getByRole("button", { name: "Create property" }).click();

    await expect(page.locator("#code-error")).toContainText(/already in use/i);
    await expect(page).toHaveURL(/\/properties\/new/); // nothing persisted
  });

  test("rejects a GSTIN with a bad check digit (AC-3)", async ({ page }) => {
    await signIn(page, ADMIN, true);
    await page.goto("/properties/new");

    // Structurally perfect, wrong check digit — the classic typo.
    await page.getByLabel("GSTIN").fill("29ABCDE1234F1Z5");
    await page.getByLabel("Property name").click(); // blur triggers validation

    await expect(page.getByText(/check digit/i)).toBeVisible();
  });

  test("rejects missing required fields (AC-10)", async ({ page }) => {
    await signIn(page, ADMIN, true);
    await page.goto("/properties/new");

    // Name only — the browser's own required-field guard must stop submission.
    await page.getByLabel("Property name").fill("Incomplete");
    await page.getByRole("button", { name: "Create property" }).click();

    await expect(page).toHaveURL(/\/properties\/new/);
  });
});
