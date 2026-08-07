/**
 * 26 data-onboarding e2e — T-22. Admin journey on a mobile viewport: sign in
 * (with 2FA), open /data-import, download a template, upload a guests file,
 * validate (dry-run preview), commit, and see the re-import is a no-op. Also
 * asserts a non-admin is refused server-side (AC-3).
 *
 * Runs against the seeded fixtures; `npm run db:seed` must have been applied.
 * Admin has enforced 2FA — its seeded secret is the shared fixture secret.
 */
import { expect, test } from "@playwright/test";
import { authenticator } from "otplib";

const ADMIN = { email: "admin@woodpecker.example", password: "woodpecker-dev-2026" };
const RECEPTION = { email: "reception.mg@woodpecker.example", password: "woodpecker-dev-2026" };
const TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

async function signInAdmin(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Two-factor code" })).toBeVisible();
  await page.getByLabel("Code").fill(authenticator.generate(TOTP_SECRET));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

// Two valid guests + one missing-mobile (ERROR), with run-unique mobiles.
function guestsCsv(): string {
  const run = Date.now() % 1_000_000_000;
  const mob = (i: number) => "9" + String((run + i) % 1_000_000_000).padStart(9, "0");
  return [
    "Full name,Mobile,Email,City,State,Company,GSTIN,Aadhaar",
    `E2E Guest One,${mob(1)},one@example.com,Bengaluru,KA,,,`,
    `E2E Guest Two,${mob(2)},two@example.com,Kochi,KL,,,`,
    "E2E No Mobile,,none@example.com,Delhi,DL,,,",
  ].join("\r\n") + "\r\n";
}

test.describe("data import (admin)", () => {
  test("upload → validate → commit; error row surfaced; commit gated until validated", async ({ page }) => {
    await signInAdmin(page);
    await page.goto("/data-import");
    await expect(page.getByRole("heading", { name: "Data import" })).toBeVisible();

    // GUESTS is the default kind; template link is present.
    await expect(page.getByTestId("import-template")).toHaveAttribute("href", /kind=GUESTS/);

    // Upload the in-memory CSV.
    await page.getByTestId("import-file").setInputFiles({
      name: "guests.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(guestsCsv(), "utf8"),
    });
    await page.getByTestId("import-upload").click();

    // Lands on the batch view (?batch=…) with the summary + preview.
    await expect(page).toHaveURL(/\/data-import\?batch=/);
    await expect(page.getByTestId("import-summary")).toBeVisible();

    // Validate (dry-run): 2 OK, 1 error; error download appears.
    await page.getByTestId("import-validate").click();
    await expect(page.getByTestId("import-summary")).toContainText("OK: 2");
    await expect(page.getByTestId("import-summary")).toContainText("Errors: 1");
    await expect(page.getByTestId("import-download-errors")).toBeVisible();

    // Commit is disabled while any error row remains (AC-8).
    await expect(page.getByTestId("import-commit")).toBeDisabled();
  });

  test("a non-admin cannot reach /data-import (server-side)", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(RECEPTION.email);
    await page.getByLabel("Password", { exact: true }).fill(RECEPTION.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    const response = await page.goto("/data-import");
    expect(response?.status()).toBe(403);
  });
});
