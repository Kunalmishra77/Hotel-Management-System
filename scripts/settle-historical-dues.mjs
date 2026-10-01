/**
 * One-off (client-authorised, MoM/decision 2026-10-01): settle the historical
 * checked-out stays that were entered (Data Entry) with room charges but NO payment,
 * so the Billing "Outstanding dues" reflects only real money owed.
 *
 * Targets ONLY folios that are:
 *   - attached to a CHECKED_OUT reservation,
 *   - have a positive balance, AND
 *   - have ZERO payments recorded (clearly never-settled historical backfill).
 * A folio with any recorded payment (partial / deferred) is LEFT UNTOUCHED — its
 * remaining balance may be a genuine due.
 *
 * It only INSERTS a settling CASH payment (= the balance) per folio. Payments are
 * append-only inserts, so no triggers are disabled and nothing is edited/deleted.
 *
 * DRY RUN by default; set CONFIRM=YES to actually post the payments.
 *   node scripts/settle-historical-dues.mjs
 *   CONFIRM=YES node scripts/settle-historical-dues.mjs
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CONFIRM = process.env.CONFIRM === "YES";

async function main() {
  const folios = await prisma.folio.findMany({
    select: {
      id: true,
      propertyId: true,
      reservationId: true,
      reservation: { select: { code: true, status: true, guest: { select: { fullName: true } } } },
    },
  });

  const targets = [];
  for (const f of folios) {
    if (f.reservation?.status !== "CHECKED_OUT") continue;
    // ONLY true Data-Entry backfill — identified by its historical-import audit
    // record. This excludes REAL recent checkouts (e.g. a guest checked out via the
    // app with an unrecorded/deferred balance), whose dues must NOT be auto-settled.
    const isImport = await prisma.auditLog.count({
      where: { entityType: "Reservation", entityId: f.reservationId, action: "reservation:historical-import" },
    });
    if (isImport === 0) continue;
    const payCount = await prisma.payment.count({ where: { folioId: f.id } });
    if (payCount > 0) continue; // has a recorded payment → leave it alone
    const lines = await prisma.folioLine.findMany({
      where: { folioId: f.id },
      select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true },
    });
    const balance = lines.reduce((n, l) => n + Number(l.amountPaise) + l.cgstPaise + l.sgstPaise + l.igstPaise, 0);
    if (balance > 0) {
      targets.push({ folioId: f.id, propertyId: f.propertyId, code: f.reservation.code, guest: f.reservation.guest?.fullName, balance });
    }
  }

  const total = targets.reduce((n, t) => n + t.balance, 0);
  console.log(`Historical checked-out folios with a balance and NO payments: ${targets.length}`);
  console.log(`Total to settle: ₹${(total / 100).toLocaleString("en-IN")}`);
  for (const t of targets.slice(0, 20)) {
    console.log(`  ${t.code} · ${t.guest ?? "—"} · ₹${(t.balance / 100).toLocaleString("en-IN")}`);
  }
  if (targets.length > 20) console.log(`  … and ${targets.length - 20} more`);

  if (!CONFIRM) {
    console.log("\nDRY RUN — nothing posted. Re-run with CONFIRM=YES to settle these folios.");
    return;
  }

  let posted = 0;
  for (const t of targets) {
    await prisma.payment.create({
      data: {
        propertyId: t.propertyId,
        folioId: t.folioId,
        mode: "CASH",
        amountPaise: BigInt(t.balance),
        reference: `HIST-SETTLE-${t.code}`,
        receivedAt: new Date(),
      },
    });
    posted += 1;
  }
  console.log(`\n✔ Settled ${posted} historical folios (₹${(total / 100).toLocaleString("en-IN")}). Outstanding now reflects real dues only.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
