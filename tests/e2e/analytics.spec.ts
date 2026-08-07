/**
 * 14-analytics T-21 — dashboard tiles + permission gating (AC-3/6), mobile
 * viewport. Manager sees financial tiles; Reception does not. The night-audit
 * run + trends are covered by the integration suite.
 */
import { expect, test, type Page } from "@playwright/test";

const MANAGER = { email: "manager.mg@woodpecker.example", password: "woodpecker-dev-2026" };
const RECEPTION = { email: "reception.mg@woodpecker.example", password: "woodpecker-dev-2026" };

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe("dashboard tiles (T-21, AC-3/6)", () => {
  test("a manager sees operational + financial tiles", async ({ page }) => {
    await signIn(page, MANAGER);
    await expect(page.getByTestId("dashboard-tiles")).toBeVisible();
    await expect(page.getByTestId("tile-occupancy")).toBeVisible();
    await expect(page.getByTestId("tile-revenue")).toBeVisible(); // report:view-financial
    await expect(page.getByTestId("run-night-audit")).toBeVisible();
  });

  test("reception sees operational tiles but NOT financial ones (AC-6)", async ({ page }) => {
    await signIn(page, RECEPTION);
    await expect(page.getByTestId("tile-occupancy")).toBeVisible();
    await expect(page.getByTestId("tile-revenue")).toHaveCount(0); // hidden server-side
    await expect(page.getByTestId("run-night-audit")).toHaveCount(0);
  });
});
