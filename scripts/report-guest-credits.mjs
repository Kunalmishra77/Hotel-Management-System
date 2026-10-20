/** READ-ONLY. Every rupee the hotel is holding that belongs to a departed guest.
 *
 *  A credit on a closed folio means the guest paid more than the folio bills.
 *  There are only a few ways that happens, and they need different answers, so
 *  the report says which one each case looks like rather than lumping them into
 *  one number:
 *
 *    "nights missing from the bill"  — the stay has fewer billed room-nights than
 *       nights stayed. The guest paid for the stay; the charge was never posted
 *       or was reversed. The bill is wrong, not the payment.
 *    "charges reversed after payment" — room-nights were reversed on a folio
 *       that had already been paid, which is what the old aggregate-line bug did
 *       at early check-out.
 *    "paid more than the bill" — a genuine overpayment, refundable.
 *    "rounding" — under ₹5, paise left over from cash rounding.
 *
 *  node scripts/report-guest-credits.mjs > guest-credits.csv
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const r2 = (p) => (Number(p) / 100).toFixed(2);
const d = (x) => (x ? x.toISOString().slice(0, 10) : "");

try {
  const today = new Date("2026-10-20T00:00:00.000Z");
  const folios = await prisma.folio.findMany({
    where: { reservation: { status: "CHECKED_OUT" } },
    select: {
      id: true, propertyId: true,
      reservation: {
        select: {
          code: true, source: true, checkInDate: true, checkOutDate: true, nights: true, ratePaise: true,
          guest: { select: { fullName: true, mobile: true } },
          allocations: { select: { room: { select: { number: true } } } },
        },
      },
      lines: { select: { id: true, type: true, quantity: true, amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, reversalOfId: true } },
      payments: { select: { amountPaise: true, isRefund: true, mode: true, receivedAt: true } },
      invoices: { select: { number: true, type: true, totalPaise: true, cancelsInvoiceId: true } },
    },
  });
  const props = new Map((await prisma.property.findMany({ select: { id: true, name: true } })).map((p) => [p.id, p.name]));

  const rows = [];
  for (const f of folios) {
    const r = f.reservation;
    if (!r || r.checkOutDate >= today) continue;
    const reversedIds = new Set(f.lines.filter((l) => l.reversalOfId).map((l) => l.reversalOfId));
    const active = f.lines.filter((l) => !reversedIds.has(l.id) && !(l.type === "REVERSAL" && l.reversalOfId));
    const bill = active.reduce((s, l) => s + BigInt(l.amountPaise) + BigInt(l.cgstPaise) + BigInt(l.sgstPaise) + BigInt(l.igstPaise), 0n);
    const paid = f.payments.reduce((s, x) => s + (x.isRefund ? -BigInt(x.amountPaise) : BigInt(x.amountPaise)), 0n);
    const credit = paid - bill;
    if (credit <= 0n) continue;

    const billedNights = active.filter((l) => l.type === "ROOM").reduce((s, l) => s + l.quantity, 0);
    const stayNights = Math.round((r.checkOutDate - r.checkInDate) / 86_400_000);
    const roomReversed = f.lines.some((l) => l.type === "REVERSAL" && reversedIds.size > 0);

    let reason;
    if (billedNights < stayNights) reason = `${stayNights - billedNights} night(s) missing from the bill`;
    else if (credit < 500n) reason = "rounding";
    else if (roomReversed) reason = "charges reversed after payment";
    else reason = "paid more than the bill";

    const liveInv = f.invoices.filter((i) => i.type === "TAX_INVOICE" && !new Set(f.invoices.filter((x) => x.cancelsInvoiceId).map((x) => x.cancelsInvoiceId)).has(i.id));

    rows.push({
      property: props.get(f.propertyId) ?? f.propertyId,
      booking: r.code,
      guest: r.guest.fullName.replace(/,/g, " "),
      rooms: r.allocations.map((a) => a.room.number).join("+"),
      source: r.source,
      checkIn: d(r.checkInDate), checkOut: d(r.checkOutDate),
      nightsStayed: stayNights, nightsBilled: billedNights,
      billTotal: r2(bill), paidTotal: r2(paid), creditHeld: r2(credit),
      lastPayment: d(f.payments.at(-1)?.receivedAt ?? null),
      invoice: liveInv.map((i) => i.number).join(" ") || "none",
      likelyReason: reason,
      confirmWith: billedNights < stayNights ? "Should the missing night(s) be billed, or is the credit refundable?" : "Refund to guest, or was something not billed?",
    });
  }
  rows.sort((a, b) => Number(b.creditHeld) - Number(a.creditHeld));

  const cols = ["property","booking","guest","rooms","source","checkIn","checkOut","nightsStayed","nightsBilled","billTotal","paidTotal","creditHeld","lastPayment","invoice","likelyReason","confirmWith"];
  console.log(cols.join(","));
  for (const x of rows) console.log(cols.map((c) => `"${x[c]}"`).join(","));
  const total = rows.reduce((s, x) => s + Number(x.creditHeld), 0);
  console.log(`"TOTAL","${rows.length} guest(s)","","","","","","","","","","${total.toFixed(2)}","","","",""`);
} catch (e) {
  console.error("Failed:", e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
