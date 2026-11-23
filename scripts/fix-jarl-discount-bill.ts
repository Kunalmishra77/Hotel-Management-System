/**
 * Jarl Meijer BK-OKMZOGSX (client, 23 Nov 2026: "no need to make a bill of the
 * discount if the guest had no change"). The ₹6.46 "no change" discount made a
 * separate ₹-6.46 Direct bill (WASPL 1076) beside the Booking.com bill (1075).
 * Under the fixed rule the discount belongs on the Booking.com bill, so this runs
 * the app's own "Correct bill" on 1075: same number 1075, now ₹3,050.00, and the
 * ₹-6.46 bill 1076 is absorbed (superseded). Nothing deleted.
 *
 *   npx tsx --require ./scripts/lib/as-user-hook.cjs scripts/fix-jarl-discount-bill.ts            (dry run)
 *   CONFIRM=YES npx tsx --require ./scripts/lib/as-user-hook.cjs scripts/fix-jarl-discount-bill.ts
 */
import { PrismaClient } from "@prisma/client";
import { assembleClaims } from "../src/lib/auth/claims";
import { reviseInvoice } from "../src/features/billing/invoice-revise-actions";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient();

async function main() {
  const owner = await prisma.user.findFirstOrThrow({ where: { email: "woodpecker.sunil@gmail.com" }, select: { id: true } });
  const claims = await assembleClaims(prisma, owner.id);
  if (!claims) throw new Error("owner has no claims");
  (globalThis as { __SCRIPT_CLAIMS?: unknown }).__SCRIPT_CLAIMS = { ...claims, activePropertyId: null };

  const r = await prisma.reservation.findFirstOrThrow({ where: { code: "BK-OKMZOGSX" }, select: { folio: { select: { id: true } } } });
  const live = await prisma.invoice.findMany({ where: { folioId: r.folio!.id, type: "TAX_INVOICE", supersededById: null }, select: { id: true, number: true, billPart: true, totalPaise: true, customerName: true, customerGstin: true } });
  for (const i of live) console.log(`live: ${i.number} [${i.billPart}] ₹${Number(i.totalPaise) / 100}`);
  const ota = live.find((i) => i.billPart === "BOOKING_COM");
  if (!ota) throw new Error("Booking.com bill not found");
  if (!APPLY) { console.log("DRY RUN — re-run with CONFIRM=YES to correct", ota.number); return; }
  const res = await reviseInvoice({ invoiceId: ota.id, customerName: ota.customerName, ...(ota.customerGstin ? { customerGstin: ota.customerGstin } : {}), reason: "Discount 'no change' belongs on the Booking.com bill — no separate discount bill (client, 23 Nov 2026)" });
  if (!res.ok) throw new Error(res.error.message);
  console.log(`corrected: ${res.data.number} rev ${res.data.revision} ₹${res.data.totalPaise / 100}`);
  const after = await prisma.invoice.findMany({ where: { folioId: r.folio!.id, type: "TAX_INVOICE", supersededById: null }, select: { number: true, billPart: true, totalPaise: true } });
  for (const i of after) console.log(`now live: ${i.number} [${i.billPart}] ₹${Number(i.totalPaise) / 100}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
