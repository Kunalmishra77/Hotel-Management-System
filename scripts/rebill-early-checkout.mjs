/**
 * One-off: re-bill EARLY check-outs to nights actually stayed. After
 * free-early-checkout-rooms.mjs has corrected each reservation's checkOutDate to the
 * real departure, this reverses any ROOM folio line dated ON/AFTER that checkout
 * (i.e. nights the guest did NOT stay) by appending a REVERSAL line (append-only;
 * no edit/delete). The folio balance then reflects only the nights stayed.
 *
 * Run free-early-checkout-rooms.mjs FIRST. DRY RUN by default; CONFIRM=YES to apply.
 *   node scripts/rebill-early-checkout.mjs
 *   CONFIRM=YES node scripts/rebill-early-checkout.mjs
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CONFIRM = process.env.CONFIRM === "YES";
const dayUTC = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

async function main() {
  const checkedOut = await prisma.reservation.findMany({
    where: { status: "CHECKED_OUT" },
    select: { id: true, code: true, checkOutDate: true, guest: { select: { fullName: true } },
      folio: { select: { id: true } } },
  });

  const plans = [];
  for (const r of checkedOut) {
    if (!r.folio) continue;
    const co = dayUTC(r.checkOutDate).getTime();
    const lines = await prisma.folioLine.findMany({
      where: { folioId: r.folio.id },
      select: { id: true, type: true, description: true, quantity: true, unitPaise: true, amountPaise: true,
        taxRateBps: true, cgstPaise: true, sgstPaise: true, igstPaise: true, hsnSac: true, placeOfSupplyState: true,
        reversalOfId: true, businessDate: true },
    });
    const reversedIds = new Set(lines.filter((l) => l.reversalOfId).map((l) => l.reversalOfId));
    // Active ROOM lines dated on/after the (corrected) checkout = nights not stayed.
    const toReverse = lines.filter((l) => l.type === "ROOM" && !reversedIds.has(l.id) && dayUTC(l.businessDate).getTime() >= co);
    if (toReverse.length === 0) continue;
    const amt = toReverse.reduce((n, l) => n + Number(l.amountPaise) + l.cgstPaise + l.sgstPaise + l.igstPaise, 0);
    plans.push({ r, folioId: r.folio.id, toReverse, amt });
  }

  console.log(`Early check-outs with nights billed past departure: ${plans.length}`);
  for (const p of plans) {
    console.log(`  ${p.r.code} · ${p.r.guest?.fullName ?? "—"} · reverse ${p.toReverse.length} night(s) dated >= ${p.r.checkOutDate.toISOString().slice(0,10)} · ₹${(p.amt/100).toLocaleString("en-IN")}`);
  }

  if (!CONFIRM) {
    console.log("\nDRY RUN — nothing changed. Re-run with CONFIRM=YES to re-bill.");
    return;
  }

  for (const p of plans) {
    await prisma.$transaction(async (tx) => {
      for (const l of p.toReverse) {
        await tx.folioLine.create({
          data: {
            folioId: p.folioId, type: "REVERSAL",
            description: `Reversal: ${l.description} (early check-out)`,
            quantity: 1, unitPaise: -l.unitPaise, amountPaise: -l.amountPaise,
            taxRateBps: l.taxRateBps, cgstPaise: -l.cgstPaise, sgstPaise: -l.sgstPaise, igstPaise: -l.igstPaise,
            hsnSac: l.hsnSac, placeOfSupplyState: l.placeOfSupplyState,
            businessDate: new Date(), reversalOfId: l.id,
          },
        });
      }
    });
  }
  console.log(`\n✔ Re-billed ${plans.length} early check-outs to nights stayed.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
