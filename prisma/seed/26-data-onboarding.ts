/**
 * 26 data-onboarding seed — T-2. Writes sample go-live import files (guests /
 * historical bookings / opening balances) to `prisma/seed/fixtures/imports/` so
 * an admin can exercise the /data-import flow immediately, and exports the same
 * CSV strings for the integration/e2e tests. No DB rows are created — imports are
 * user-driven (upload → validate → commit); ORG/PROP-A/U-ADMIN come from 00/01.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";

/** 5 guests: 4 valid, 1 missing mobile (ERROR), 1 in-file duplicate mobile. */
export const SAMPLE_GUESTS_CSV = [
  "Full name,Mobile,Email,City,State,Company,GSTIN,Aadhaar",
  "Asha Rao,9800000101,asha@example.com,Bengaluru,Karnataka,,,1111 2222 3333",
  "Vikram Nair,9800000102,vikram@example.com,Kochi,Kerala,,,",
  "Priya Shah,9800000103,priya@example.com,Mumbai,Maharashtra,,,",
  "Missing Mobile,,nomobile@example.com,Delhi,Delhi,,,",
  "Asha Rao (dup),9800000101,asha2@example.com,Bengaluru,Karnataka,,,",
].join("\r\n") + "\r\n";

/** 2 historical stays referencing guests by mobile. */
export const SAMPLE_RESERVATIONS_CSV = [
  "Guest mobile,Check-in (YYYY-MM-DD),Check-out (YYYY-MM-DD),Source,Room category,Room no,Amount (₹),External booking id",
  "9800000101,2024-11-01,2024-11-03,DIRECT,Deluxe,,8000,LEGACY-2001",
  "9800000102,2024-12-10,2024-12-12,PHONE,Deluxe,,9000,LEGACY-2002",
].join("\r\n") + "\r\n";

/** 2 opening outstanding balances (guest mobile + ₹). */
export const SAMPLE_BALANCES_CSV = [
  "Guest mobile,Outstanding amount (₹)",
  "9800000101,1500",
  "9800000103,2750",
].join("\r\n") + "\r\n";

export async function seedDataOnboarding(_prisma: PrismaClient): Promise<void> {
  const dir = join(process.cwd(), "prisma", "seed", "fixtures", "imports");
  await mkdir(dir, { recursive: true });
  await Promise.all([
    writeFile(join(dir, "sample-guests.csv"), SAMPLE_GUESTS_CSV, "utf8"),
    writeFile(join(dir, "sample-reservations.csv"), SAMPLE_RESERVATIONS_CSV, "utf8"),
    writeFile(join(dir, "sample-balances.csv"), SAMPLE_BALANCES_CSV, "utf8"),
  ]);
}
