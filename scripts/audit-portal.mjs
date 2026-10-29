/**
 * FULL portal data audit — read-only. Every property, every check that has bitten
 * us live. Prints a categorised report; writes nothing.
 *   node scripts/audit-portal.mjs
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const d = (x) => new Date(x).toISOString().slice(0, 10);
const inr = (p) => `₹${(Number(p) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const out = (title, rows) => { console.log(`\n### ${title} — ${rows.length}`); for (const r of rows.slice(0, 60)) console.log("  " + r); if (rows.length > 60) console.log(`  … +${rows.length - 60} more`); };

async function main() {
  const props = await prisma.property.findMany({ where: { deletedAt: null }, select: { id: true, code: true, timezone: true } });
  const pcode = new Map(props.map((p) => [p.id, p.code]));
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: props[0]?.timezone ?? "Asia/Kolkata" });
  const today = new Date(`${todayStr}T00:00:00.000Z`);
  console.log(`AUDIT · today (property-local) ${todayStr} · ${props.length} properties`);

  const rs = await prisma.reservation.findMany({
    where: { status: { notIn: ["CANCELLED", "NO_SHOW"] } },
    select: {
      id: true, code: true, status: true, source: true, propertyId: true, guestId: true, checkInDate: true, checkOutDate: true, ratePaise: true, externalHotelName: true,
      guest: { select: { fullName: true } },
      allocations: { select: { roomId: true, startDate: true, endDate: true, room: { select: { number: true, status: true } } } },
      folio: { select: { id: true,
        lines: { select: { id: true, type: true, description: true, amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, reversalOfId: true } },
        payments: { select: { amountPaise: true, isRefund: true } },
        invoices: { select: { number: true, type: true, totalPaise: true, cancelsInvoiceId: true, id: true }, orderBy: { issuedAt: "asc" } } } },
    },
  });
  const tag = (r) => `${r.code} · ${r.guest.fullName} @ ${pcode.get(r.propertyId)} [${r.status}] ${d(r.checkInDate)}→${d(r.checkOutDate)}`;

  // 1. Unallocated (not off-site)
  out("1. NO ROOM ALLOCATED (shows 'Unallocated')", rs.filter((r) => !r.externalHotelName && r.allocations.length === 0).map((r) => `${tag(r)} src=${r.source}`));

  // 2. Possible duplicate bookings: same guest + property + overlapping dates
  const dups = [];
  const byGuestProp = new Map();
  for (const r of rs) { const k = `${r.guestId}|${r.propertyId}`; byGuestProp.set(k, [...(byGuestProp.get(k) ?? []), r]); }
  for (const list of byGuestProp.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (a.checkInDate < b.checkOutDate && b.checkInDate < a.checkOutDate) dups.push(`${tag(a)}  ⟷  ${b.code} [${b.status}] ${d(b.checkInDate)}→${d(b.checkOutDate)}`);
  }
  out("2. POSSIBLE DUPLICATE BOOKINGS (same guest, same property, overlapping dates)", dups);

  // 3/4. Stale lifecycle
  out("3. IN-HOUSE but check-out date already passed", rs.filter((r) => r.status === "IN_HOUSE" && r.checkOutDate < today).map(tag));
  out("4. CONFIRMED but arrival date passed (not checked in / not no-show)", rs.filter((r) => (r.status === "CONFIRMED" || r.status === "ENQUIRY") && r.checkInDate < today).map(tag));

  // 5. Room status drift
  const rooms = await prisma.room.findMany({ where: { isActive: true }, select: { id: true, number: true, status: true, propertyId: true } });
  const occToday = new Map();
  for (const r of rs.filter((x) => x.status === "IN_HOUSE")) for (const a of r.allocations) if (a.startDate <= today && a.endDate > today) occToday.set(a.roomId, r);
  const drift = [];
  for (const room of rooms) {
    const who = occToday.get(room.id);
    if (who && room.status !== "OCCUPIED") drift.push(`${pcode.get(room.propertyId)} ${room.number}: guest ${who.guest.fullName} (${who.code}) is in-house but room shows ${room.status}`);
    if (!who && room.status === "OCCUPIED") drift.push(`${pcode.get(room.propertyId)} ${room.number}: shows OCCUPIED but nobody is in-house in it today`);
  }
  out("5. ROOM STATUS DRIFT (board vs bookings)", drift);

  // 6-8. Money
  const net = (lines) => { const rev = new Set(lines.filter((l) => l.reversalOfId).map((l) => l.reversalOfId)); return lines.filter((l) => l.type !== "REVERSAL" && !rev.has(l.id)); };
  const tot = (lines) => lines.reduce((s, l) => s + BigInt(l.amountPaise) + BigInt(l.cgstPaise) + BigInt(l.sgstPaise) + BigInt(l.igstPaise), 0n);
  const bal = [], noInv = [], staleInv = [], unbilled = [];
  for (const r of rs.filter((x) => x.folio)) {
    const all = r.folio.lines; const active = net(all);
    const b = tot(all) - r.folio.payments.reduce((s, p) => s + (p.isRefund ? -BigInt(p.amountPaise) : BigInt(p.amountPaise)), 0n);
    if (r.status === "CHECKED_OUT" && (b > 99n || b < -99n)) bal.push(`${tag(r)}  balance ${inr(b)}${b < 0 ? " (guest credit)" : " (still owed)"}`);
    const roomCharged = active.filter((l) => l.type === "ROOM").reduce((s, l) => s + BigInt(l.amountPaise), 0n);
    if ((r.status === "CHECKED_OUT" || r.status === "IN_HOUSE") && roomCharged === 0n && r.source !== "MAKEMYTRIP_X") unbilled.push(`${tag(r)} src=${r.source} — no room charge (rate ${inr(r.ratePaise)})`);
    const voided = new Set(r.folio.invoices.filter((i) => i.cancelsInvoiceId).map((i) => i.cancelsInvoiceId));
    const live = r.folio.invoices.filter((i) => i.type === "TAX_INVOICE" && !voided.has(i.id));
    if (r.status === "CHECKED_OUT" && active.length > 0 && live.length === 0) noInv.push(`${tag(r)} — checked out, no GST invoice`);
    if (live.length > 0) { const last = live[live.length - 1]; const ft = tot(active); if (BigInt(last.totalPaise) !== ft && (BigInt(last.totalPaise) - ft > 99n || ft - BigInt(last.totalPaise) > 99n)) staleInv.push(`${tag(r)} — invoice ${last.number} ${inr(last.totalPaise)} vs bill now ${inr(ft)}`); }
    if (live.length > 1) staleInv.push(`${tag(r)} — ${live.length} active tax invoices (${live.map((i) => i.number).join(", ")})`);
  }
  out("6. CHECKED-OUT WITH BALANCE ≠ 0", bal);
  out("7. CHECKED-OUT WITHOUT A GST INVOICE", noInv);
  out("8. INVOICE DOESN'T MATCH THE BILL / MULTIPLE INVOICES", staleInv);
  out("9. NO ROOM CHARGE ON THE BILL (room revenue missing)", unbilled);

  // 10. Guest duplicates left (same contact, different names)
  const g = await prisma.$queryRawUnsafe(`SELECT array_agg("fullName") n FROM "Guest" WHERE "deletedAt" IS NULL AND "mobileHash" IS NOT NULL GROUP BY "orgId","mobileHash" HAVING count(*)>1`);
  out("10. GUESTS SHARING A MOBILE (different names — needs a human call)", g.map((x) => x.n.join(" / ")));
}
main().catch((e) => { console.error("FAILED:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
