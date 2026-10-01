/**
 * One-off: free rooms wrongly blocked by EARLY check-outs made before the
 * early-checkout fix shipped. For any CHECKED_OUT reservation whose room allocation
 * still runs past the actual departure (checkOutAt date, property-local), shrink the
 * allocation end AND the reservation's checkOutDate/nights to the real departure, so
 * the vacated nights become sellable again.
 *
 * Operational only (allocation + reservation dates) — touches NO folio/payment/invoice.
 * Normal on-time check-outs are left untouched (end already == departure).
 *
 * DRY RUN by default; set CONFIRM=YES to apply.
 *   node scripts/free-early-checkout-rooms.mjs
 *   CONFIRM=YES node scripts/free-early-checkout-rooms.mjs
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CONFIRM = process.env.CONFIRM === "YES";

const dayUTC = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const nightsBetween = (a, b) => Math.max(1, Math.round((dayUTC(b) - dayUTC(a)) / 86_400_000));

async function main() {
  const props = await prisma.property.findMany({ select: { id: true, name: true, timezone: true } });
  const tz = new Map(props.map((p) => [p.id, p.timezone]));
  const pname = new Map(props.map((p) => [p.id, p.name]));

  const checkedOut = await prisma.reservation.findMany({
    where: { status: "CHECKED_OUT", checkOutAt: { not: null } },
    select: { id: true, code: true, propertyId: true, checkInDate: true, checkOutDate: true, checkOutAt: true,
      guest: { select: { fullName: true } },
      allocations: { select: { id: true, startDate: true, endDate: true, room: { select: { number: true } } } } },
  });

  const fixes = [];
  for (const r of checkedOut) {
    const zone = tz.get(r.propertyId) ?? "Asia/Kolkata";
    const outStr = new Date(r.checkOutAt).toLocaleDateString("en-CA", { timeZone: zone }); // yyyy-mm-dd local
    const effectiveOut = new Date(`${outStr}T00:00:00.000Z`);
    // clamp to at least 1 night after check-in
    const minOut = new Date(dayUTC(r.checkInDate).getTime() + 86_400_000);
    const eff = effectiveOut.getTime() < minOut.getTime() ? minOut : effectiveOut;
    const overBlocked = r.allocations.filter((a) => dayUTC(a.endDate).getTime() > eff.getTime());
    if (overBlocked.length === 0) continue; // on-time / already correct
    fixes.push({ r, eff, overBlocked });
  }

  console.log(`Early check-outs with a room still blocked past departure: ${fixes.length}`);
  for (const f of fixes) {
    console.log(`  ${f.r.code} · ${f.r.guest?.fullName ?? "—"} · ${pname.get(f.r.propertyId)} · booked out ${f.r.checkOutDate.toISOString().slice(0,10)} → actual ${f.eff.toISOString().slice(0,10)} · rooms ${f.overBlocked.map((a)=>a.room.number).join(", ")}`);
  }

  if (!CONFIRM) {
    console.log("\nDRY RUN — nothing changed. Re-run with CONFIRM=YES to free these rooms.");
    return;
  }

  for (const f of fixes) {
    await prisma.$transaction(async (tx) => {
      for (const a of f.overBlocked) {
        await tx.roomAllocation.update({ where: { id: a.id }, data: { endDate: f.eff } });
      }
      await tx.reservation.update({
        where: { id: f.r.id },
        data: { checkOutDate: f.eff, nights: nightsBetween(f.r.checkInDate, f.eff) },
      });
    });
  }
  console.log(`\n✔ Freed ${fixes.length} early-checkout rooms.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
