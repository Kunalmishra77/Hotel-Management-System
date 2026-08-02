/**
 * 22 · Accounting Sync — T-2 seed fixtures
 * (specs/22-accounting-sync/user-stories.md § Test Fixtures).
 *
 * PROV — AccountingConfig(provider "zoho", mode "sandbox") for the org, with a
 * sample GL mapping, so the whole event → enqueue → syncWorker flow runs against
 * the mock adapter with ZERO external accounts (FR-4). Idempotent (fixed id +
 * upsert), like every seed module.
 *
 * The invoice / expense / payroll fixtures the spec references (INV-1 / EXP-1 /
 * PAY-1) are created by their owning modules' seeds (06 / 07 / 21); 22 only owns
 * the sync config + its logs, so there is nothing else to materialize here.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { ORG_ID } from "./fixtures";

/** PROV — the sandbox Zoho Books accounting config. */
export const ACCOUNTING_CONFIG_ID = "acccfg_zoho_woodpecker";

export function sampleGlMappings(): Prisma.InputJsonValue {
  return {
    invoice: "Sales",
    creditNote: "Sales Returns",
    payment: "Bank",
    refund: "Bank",
    payroll: "Salaries & Wages",
    expense: {
      HOUSEKEEPING: "Housekeeping Expenses",
      KITCHEN: "Kitchen & F&B",
      MAINTENANCE: "Repairs & Maintenance",
      UTILITIES: "Utilities",
      STAFF: "Staff Welfare",
      ADMINISTRATION: "Administrative Expenses",
      MISC: "Miscellaneous Expenses",
    },
  };
}

export async function seedAccounting(prisma: PrismaClient): Promise<void> {
  await prisma.accountingConfig.upsert({
    where: { orgId_provider: { orgId: ORG_ID, provider: "zoho" } },
    create: {
      id: ACCOUNTING_CONFIG_ID,
      orgId: ORG_ID,
      provider: "zoho",
      mode: "sandbox",
      credentialsRef: null,
      glMappings: sampleGlMappings(),
    },
    update: { mode: "sandbox", glMappings: sampleGlMappings() },
  });
}
