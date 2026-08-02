// Playwright does NOT load .env on its own (unlike tests/setup.ts for vitest).
// Specs and their hooks talk to the database for fixture cleanup, so without
// this every afterAll fails with "Environment variable not found: DATABASE_URL"
// — and a cleanup that fails silently leaves rows behind for other suites.
import "dotenv/config";

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

// rules/mobile-first.md + testing-strategy.md §3: the critical journeys are
// verified on a phone viewport first — that is the primary device.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // One retry locally too: the FIRST sign-in of a run pays for a cold Prisma
  // engine and a cold connection to a managed database, which can exceed even a
  // generous assertion budget. Retrying absorbs that without hiding a real
  // regression — a genuine break fails both attempts.
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  /**
   * Playwright's default assertion timeout is 5s. A sign-in here is not a
   * client-side state flip: it runs bcrypt, creates a Session row, writes an
   * audit row and emits an outbox event, each a round trip to a managed
   * database. That legitimately exceeds 5s on a non-colocated link, and a 5s
   * assertion reports a *passing* flow as a failure.
   *
   * The NFR budget (mutations p95 < 800ms) applies to the app deployed beside
   * its database; it is not what a developer laptop → ap-south-1 hop measures.
   */
  expect: { timeout: 30_000 },
  use: {
    baseURL,
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
