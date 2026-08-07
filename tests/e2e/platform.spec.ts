/**
 * 00-platform T-23 — critical journeys on a mobile viewport.
 *
 * tasks.md: "Journeys: password sign-in; 2FA sign-in; forbidden cross-property;
 * property switch. (AC-1/2/9/25)"
 *
 * Runs against the seeded fixtures; `npm run db:seed` must have been applied.
 */
import { expect, test } from "@playwright/test";
import { authenticator } from "otplib";

const RECEPTION = { email: "reception.mg@woodpecker.example", password: "woodpecker-dev-2026" };
const ACCOUNTS = { email: "accounts@woodpecker.example", password: "woodpecker-dev-2026" };
const ACCOUNTS_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

function currentTotp(): string {
  return authenticator.generate(ACCOUNTS_TOTP_SECRET);
}

async function fillCredentials(
  page: import("@playwright/test").Page,
  who: { email: string; password: string },
): Promise<void> {
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/**
 * The form's own error message.
 *
 * Next injects `#__next-route-announcer__` with role="alert" for screen-reader
 * route changes, so a bare getByRole("alert") matches two elements and trips
 * strict mode. Scope to the form to mean the one we actually rendered.
 */
function formAlert(page: import("@playwright/test").Page) {
  return page.locator("form p[role=alert]");
}

test.describe("auth gate (FR-26 / AC-24)", () => {
  test("an unauthenticated dashboard request redirects to sign-in and preserves the target", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });
});

test.describe("password sign-in (AC-1)", () => {
  test("Reception signs in and lands on the dashboard", async ({ page }) => {
    await page.goto("/sign-in");
    await fillCredentials(page, RECEPTION);

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: /Welcome, Priya Nair/ })).toBeVisible();
    await expect(page.getByText(/RECEPTION/)).toBeVisible();
  });

  test("a wrong password is rejected with the generic message (AC-4: no enumeration)", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(RECEPTION.email);
    await page.getByLabel("Password", { exact: true }).fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    const wrongPassword = await formAlert(page).innerText();

    // An address with no account must produce the SAME text.
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill("nobody-here@woodpecker.example");
    await page.getByLabel("Password", { exact: true }).fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(formAlert(page)).toHaveText(wrongPassword);
  });
});

test.describe("nav is permission-filtered (AC-24)", () => {
  test("Reception sees operational sections but no administration", async ({ page }) => {
    await page.goto("/sign-in");
    await fillCredentials(page, RECEPTION);
    await expect(page).toHaveURL(/\/dashboard/);

    // On a phone the sidebar is deliberately hidden (`hidden md:block`) and the
    // bottom tab bar is the navigation — mobile-first.md. Assert what the user
    // on the primary device actually sees.
    const bar = page.getByRole("navigation", { name: "Primary" });
    await expect(bar.getByRole("link", { name: "Bookings" })).toBeVisible();
    await expect(bar.getByRole("link", { name: "Guests" })).toBeVisible();

    // …and the server-rendered access list, which is viewport-independent.
    await expect(page.getByTestId("access-bookings")).toBeVisible();
    await expect(page.getByTestId("access-housekeeping")).toBeVisible();
    // Not granted to RECEPTION by the RBAC matrix.
    await expect(page.getByTestId("access-users")).toHaveCount(0);
    await expect(page.getByTestId("access-reports")).toHaveCount(0);
    await expect(page.getByTestId("access-expenses")).toHaveCount(0);
    await expect(page.getByTestId("access-settings")).toHaveCount(0);
  });
});

test.describe("server-side authorization (FR-13 / AC-11)", () => {
  test("Reception typing a forbidden URL gets 403, not the page", async ({ page }) => {
    await page.goto("/sign-in");
    await fillCredentials(page, RECEPTION);
    await expect(page).toHaveURL(/\/dashboard/);

    // Hiding the nav item is cosmetic; the server must refuse the request.
    const response = await page.goto("/settings/users");
    expect(response?.status()).toBe(403);
    await expect(page.getByRole("heading", { name: "Not permitted" })).toBeVisible();
  });
});

test.describe("2FA sign-in (AC-2 / AC-3)", () => {
  test("a correct password alone issues no session; the code completes it", async ({ page }) => {
    await page.goto("/sign-in");
    await fillCredentials(page, ACCOUNTS);

    // AC-2: no session yet — the challenge is shown instead of the dashboard.
    await expect(page.getByRole("heading", { name: "Two-factor code" })).toBeVisible();
    await expect(page).not.toHaveURL(/\/dashboard/);

    await page.getByLabel("Code").fill(currentTotp());
    await page.getByRole("button", { name: "Verify" }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: /Welcome, Suresh Iyer/ })).toBeVisible();
  });

  test("an invalid code keeps the user on the challenge step", async ({ page }) => {
    await page.goto("/sign-in");
    await fillCredentials(page, ACCOUNTS);
    await expect(page.getByRole("heading", { name: "Two-factor code" })).toBeVisible();

    await page.getByLabel("Code").fill("000000");
    await page.getByRole("button", { name: "Verify" }).click();

    await expect(formAlert(page)).toContainText(/isn't valid/i);
    await expect(page.getByRole("heading", { name: "Two-factor code" })).toBeVisible();
    await expect(page).not.toHaveURL(/\/dashboard/);
  });
});

test.describe("property switcher (FR-27 / AC-25)", () => {
  test("a single-property user sees no switcher", async ({ page }) => {
    await page.goto("/sign-in");
    await fillCredentials(page, RECEPTION);
    await expect(page).toHaveURL(/\/dashboard/);

    await expect(page.getByRole("button", { name: /Change property/ })).toHaveCount(0);
    await expect(page.getByText("Woodpecker MG Road")).toBeVisible();
  });

  test("a multi-property user switches, and the choice survives navigation", async ({ page }) => {
    await page.goto("/sign-in");
    await fillCredentials(page, ACCOUNTS);
    await page.getByLabel("Code").fill(currentTotp());
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.getByRole("button", { name: /Change property/ }).click();
    const listbox = page.getByRole("listbox", { name: "Properties" });
    await expect(listbox.getByRole("option")).toHaveCount(2); // only their two
    await listbox.getByRole("option", { name: /Whitefield/ }).click();

    await expect(page.getByRole("button", { name: /Woodpecker Whitefield/ })).toBeVisible();

    // AC-25: "preserved across navigation".
    await page.goto("/bookings");
    await expect(page.getByRole("button", { name: /Woodpecker Whitefield/ })).toBeVisible();
  });
});

test.describe("revoked session (regression)", () => {
  test("a revoked session lands on sign-in, not a redirect loop", async ({ page, context }) => {
    await page.goto("/sign-in");
    await fillCredentials(page, RECEPTION);
    await expect(page).toHaveURL(/\/dashboard/);

    // Sign out revokes the DB row. The Auth.js JWT cookie is deliberately put
    // back afterwards to reproduce the real-world state that caused
    // ERR_TOO_MANY_REDIRECTS: a live-looking cookie over a dead session.
    const cookies = await context.cookies();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await context.addCookies(cookies);

    // Must settle on the sign-in form rather than ping-ponging.
    const response = await page.goto("/properties");
    expect(response?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });
});

test.describe("sign-out", () => {
  test("revokes the session so the dashboard is unreachable again", async ({ page }) => {
    await page.goto("/sign-in");
    await fillCredentials(page, RECEPTION);
    await expect(page).toHaveURL(/\/dashboard/);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

test.describe("health endpoint", () => {
  test("reports the database is reachable", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", database: "up" });
  });
});
