/**
 * Set one OTA's deduction rule from its statement, through the app's own
 * `saveChannelDeduction` (audited). Same as Reports → Channels → settings.
 *   SOURCE=MAKEMYTRIP COMMISSION_BPS=1500 GST_BPS=1800 TCS_BPS=50 TDS_BPS=10 \
 *   [EXTRA_BPS=700 EXTRA_LABEL=Accelerator] [ON_GROSS=1] CONFIRM=YES \
 *   npx tsx --require ./scripts/lib/as-user-hook.cjs scripts/set-ota-deduction.ts
 * MAKEMYTRIP (voucher NH73039534032550, 23 Nov 2026): 15% on pre-GST, 18% GST on it, TCS 0.5%, TDS 0.1%.
 */
import { PrismaClient } from "@prisma/client";
import { assembleClaims } from "../src/lib/auth/claims";
import { saveChannelDeduction } from "../src/features/reports/ota-deduction-actions";

const prisma = new PrismaClient();
const env = (k: string, d = "0") => Number(process.env[k] ?? d);

async function main() {
  const owner = await prisma.user.findFirstOrThrow({ where: { email: "woodpecker.sunil@gmail.com" }, select: { id: true } });
  const claims = await assembleClaims(prisma, owner.id);
  if (!claims) throw new Error("owner has no claims");
  (globalThis as { __SCRIPT_CLAIMS?: unknown }).__SCRIPT_CLAIMS = { ...claims, activePropertyId: null };
  const input = {
    source: process.env.SOURCE, commissionBps: env("COMMISSION_BPS"), commissionOnGross: process.env.ON_GROSS === "1",
    extraFeeBps: env("EXTRA_BPS"), extraFeeLabel: process.env.EXTRA_LABEL, gstOnCommissionBps: env("GST_BPS", "1800"), tcsBps: env("TCS_BPS", "50"), tdsBps: env("TDS_BPS", "10"),
  };
  console.log("now:", await prisma.channelDeduction.findFirst({ where: { source: input.source } }));
  console.log("set:", input);
  if (process.env.CONFIRM !== "YES") { console.log("DRY RUN"); return; }
  const res = await saveChannelDeduction(input);
  console.log(res.ok ? "saved" : res.error.message);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
