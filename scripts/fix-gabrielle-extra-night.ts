/**
 * Gabrielle Mary Dowling, BK-USFUSGPI (HKD3, R1) — booked 30→31 Oct (1 night),
 * paid ₹2,550 by card. Check-out was pressed late on 1 Nov, so the old night
 * audit billed 31 Oct too and extended the stay to 1 Nov; a 2nd ₹2,550 card
 * payment was then entered and invoice WASPL 863 issued for ₹5,100.
 *
 * Fix (append-only):
 *  - reverse the 31 Oct night-audit charge; fix the whole-rupee round-off;
 *  - stay back to 30→31 Oct (1 night), room allocation to 31 Oct;
 *  - the 2nd ₹2,550 card payment, by EXTRA=
 *      (unset)   leave it → the bill shows ₹2,550 to refund to the guest
 *      mistake   it was entered by mistake (card charged once) → cancel the entry
 *      refunded  the card was charged twice and ₹2,550 was refunded → record the refund
 *  - restate the 31 Oct daily snapshot.
 * Invoice WASPL 863 is NOT touched — Void & revise it in the app afterwards.
 *
 * Run inside the app container (it has the production DB env):
 *   npx tsx scripts/fix-gabrielle-extra-night.ts                          (dry-run)
 *   CONFIRM=YES EXTRA=mistake npx tsx scripts/fix-gabrielle-extra-night.ts (apply)
 */
import { PrismaClient } from "@prisma/client";
import { runWithSystemContext } from "../src/lib/context";
import { writeAudit } from "../src/lib/audit";
import { activeLines, folioBalance } from "../src/features/billing";
import { restatePastSnapshots } from "../src/features/analytics/night-audit";

const APPLY = process.env.CONFIRM === "YES";
const EXTRA = (process.env.EXTRA ?? "").toLowerCase();
if (!["", "mistake", "refunded"].includes(EXTRA)) throw new Error("EXTRA must be unset, 'mistake' or 'refunded'");
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const inr = (p: number | bigint) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const OUT = new Date("2026-10-31T00:00:00Z");
const EXTRA_NIGHT = new Date("2026-10-31T00:00:00Z");

async function main() {
  const r = await prisma.reservation.findFirstOrThrow({
    where: { code: "BK-USFUSGPI" },
    select: {
      id: true, status: true, propertyId: true, checkInDate: true, checkOutDate: true, nights: true,
      guest: { select: { fullName: true } },
      property: { select: { orgId: true } },
      allocations: { select: { id: true, endDate: true } },
      folio: { select: { id: true, lines: true, payments: true } },
    },
  });
  if (!r.guest.fullName.toLowerCase().includes("gabrielle")) throw new Error("unexpected guest");
  if (r.checkOutDate.toISOString().slice(0, 10) !== "2026-11-01") throw new Error(`check-out is ${r.checkOutDate.toISOString().slice(0, 10)} — already fixed?`);
  const folio = r.folio!;
  const active = activeLines(folio.lines);
  const night = active.find((l) => l.type === "ROOM" && l.businessDate.getTime() === EXTRA_NIGHT.getTime());
  if (!night) throw new Error("no active 31 Oct room charge — already reversed?");
  const roundOff = active.find((l) => l.type === "MISC" && l.description === "Round off");
  const second = folio.payments.filter((p) => !p.isRefund).sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())[0];
  if (!second || second.receivedAt.toISOString().slice(0, 10) !== "2026-11-01" || second.amountPaise !== 255_000n) throw new Error("the 1 Nov ₹2,550 card payment wasn't found as expected");

  // Charges after the fix, before any new round-off.
  const keep = active.filter((l) => l.id !== night.id && l.id !== roundOff?.id);
  const charges = keep.reduce((s, l) => s + BigInt(l.amountPaise) + BigInt(l.cgstPaise) + BigInt(l.sgstPaise) + BigInt(l.igstPaise), 0n);
  const newRound = Number(((charges + 50n) / 100n) * 100n - charges); // to the whole rupee
  const paidAfter = folio.payments.reduce((s, p) => s + (p.isRefund ? -p.amountPaise : p.amountPaise), 0n) - (EXTRA ? 255_000n : 0n);

  console.log(`${r.guest.fullName} · ${r.status} · ${r.checkInDate.toISOString().slice(0, 10)}→${r.checkOutDate.toISOString().slice(0, 10)} (${r.nights}n) · balance now ${inr(folioBalance(folio.lines, folio.payments))}`);
  console.log(`  reverse 31 Oct night ${inr(BigInt(night.amountPaise) + BigInt(night.cgstPaise + night.sgstPaise))}${roundOff ? ` + round-off ${inr(roundOff.amountPaise)}` : ""}; new round-off ${inr(newRound)}`);
  console.log(`  stay → 30→31 Oct (1 night) · bill ${inr(charges + BigInt(newRound))}`);
  console.log(`  2nd card payment ${inr(second.amountPaise)}: ${EXTRA === "mistake" ? "cancel the entry (card charged once)" : EXTRA === "refunded" ? "record the ₹2,550 refund to card" : "left as is → ₹2,550 to refund"}`);
  console.log(`  balance after: ${inr(charges + BigInt(newRound) - paidAfter)}`);
  if (!APPLY) { console.log("\nDRY RUN — nothing written. Re-run with CONFIRM=YES (and EXTRA=…) to apply."); return; }

  await runWithSystemContext(r.property.orgId, async () => {
    await prisma.$transaction(async (tx) => {
      const rev = (l: typeof night, why: string) => ({
        folioId: folio.id, type: "REVERSAL" as const, description: `Reversal: ${l.description} (${why})`,
        quantity: 1, unitPaise: -l.unitPaise, amountPaise: -l.amountPaise, taxRateBps: l.taxRateBps,
        cgstPaise: -l.cgstPaise, sgstPaise: -l.sgstPaise, igstPaise: -l.igstPaise, hsnSac: l.hsnSac,
        placeOfSupplyState: l.placeOfSupplyState, businessDate: new Date(), reversalOfId: l.id,
      });
      await tx.folioLine.createMany({
        data: [
          rev(night, "booked 30→31 Oct; check-out pressed late"),
          ...(roundOff ? [rev(roundOff, "re-rounded after the correction")] : []),
        ],
      });
      if (newRound !== 0) {
        await tx.folioLine.create({ data: {
          folioId: folio.id, type: "MISC", description: "Round off", quantity: 1, unitPaise: newRound, amountPaise: BigInt(newRound),
          taxRateBps: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, hsnSac: null, placeOfSupplyState: night.placeOfSupplyState, businessDate: new Date(),
        } });
      }
      await tx.reservation.update({ where: { id: r.id }, data: { checkOutDate: OUT, nights: 1 } });
      await tx.roomAllocation.updateMany({ where: { reservationId: r.id, endDate: { gt: OUT } }, data: { endDate: OUT } });
      if (EXTRA === "mistake") {
        await tx.payment.create({ data: {
          propertyId: r.propertyId, folioId: folio.id, mode: second.mode, amountPaise: second.amountPaise, isRefund: true,
          reference: `CORRECTION:${second.id} entered for a night that was never stayed`, receivedAt: second.receivedAt,
        } });
      } else if (EXTRA === "refunded") {
        await tx.payment.create({ data: {
          propertyId: r.propertyId, folioId: folio.id, mode: second.mode, amountPaise: second.amountPaise, isRefund: true,
          reference: "Refund to card — 31 Oct night billed by mistake",
        } });
      }
      await writeAudit(tx, {
        action: "reservation:correct-stay", entityType: "Reservation", entityId: r.id, propertyId: r.propertyId,
        reason: "Booked 30→31 Oct; late check-out made the night audit bill 31 Oct",
        before: { checkOutDate: "2026-11-01", nights: 2 }, after: { checkOutDate: "2026-10-31", nights: 1, extraPayment: EXTRA || "left as credit" },
      });
    });
    await restatePastSnapshots(r.propertyId, [EXTRA_NIGHT], "Gabrielle BK-USFUSGPI: 31 Oct night reversed");
  });
  const after = await prisma.folio.findUniqueOrThrow({ where: { id: folio.id }, select: { lines: true, payments: true } });
  console.log(`✅ Done. Balance now ${inr(folioBalance(after.lines, after.payments))}. Next: Void & revise invoice WASPL 863 in the app.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
