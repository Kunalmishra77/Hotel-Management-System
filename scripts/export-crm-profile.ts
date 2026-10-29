/**
 * READ-ONLY full CRM data profile → one Excel workbook for line-by-line checking
 * against the physical bills. Sheets: Summary · Bookings · Invoices · Payments ·
 * Guests · Rooms · Flags. Mobile/email are MASKED (compliance.md: PII masked in
 * exports by default). Writes nothing to the database.
 *   npx tsx scripts/export-crm-profile.ts "<output.xlsx>"
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import { decryptOptional, maskMobile, maskEmail } from "../src/lib/crypto/encryption";

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const OUT = process.argv[2] ?? "crm-profile.xlsx";
const rs = (p: bigint | number) => Math.round(Number(p)) / 100; // paise → ₹ number
const day = (d: Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const SRC: Record<string, string> = { MAKEMYTRIP: "MakeMyTrip", BOOKING_COM: "Booking.com", AIRBNB: "Airbnb", AGODA: "Agoda", GOIBIBO: "Goibibo", DIRECT: "Direct", WALK_IN: "Walk-in", WEBSITE: "Website", PHONE: "Phone", CORPORATE: "Corporate", TRAVEL_AGENT: "Travel agent" };

async function main() {
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const today = new Date(`${todayStr}T00:00:00.000Z`);
  const props = await prisma.property.findMany({ where: { deletedAt: null }, select: { id: true, code: true, name: true, isCostCenter: true } });
  const pname = new Map(props.map((p) => [p.id, p.name]));

  const res = await prisma.reservation.findMany({
    select: {
      id: true, code: true, status: true, source: true, propertyId: true, guestId: true, createdAt: true,
      checkInDate: true, checkOutDate: true, checkInAt: true, checkOutAt: true, nights: true, adults: true, children: true,
      ratePaise: true, settlementIntent: true, transferredFromId: true, externalHotelName: true, needsAttention: true, channelRef: true,
      guest: { select: { fullName: true, mobile: true, gstNumber: true, companyName: true } },
      allocations: { select: { startDate: true, endDate: true, room: { select: { number: true, category: { select: { name: true } } } } }, orderBy: { startDate: "asc" } },
      folio: { select: { id: true,
        lines: { select: { id: true, type: true, description: true, amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, reversalOfId: true, businessDate: true } },
        payments: { select: { mode: true, amountPaise: true, isRefund: true, receivedAt: true, reference: true } },
        invoices: { select: { id: true, number: true, type: true, totalPaise: true, taxableValuePaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, cancelsInvoiceId: true, issuedAt: true, customerName: true, customerGstin: true } },
      } },
    },
    orderBy: [{ propertyId: "asc" }, { checkInDate: "asc" }],
  });
  const codeById = new Map(res.map((r) => [r.id, r.code]));

  // Duplicate pairs: same guest + property + overlapping dates, neither cancelled.
  const dupOf = new Map<string, string[]>();
  const live = res.filter((r) => r.status !== "CANCELLED" && r.status !== "NO_SHOW");
  for (const a of live) for (const b of live) {
    if (a.id < b.id && a.guestId === b.guestId && a.propertyId === b.propertyId && a.checkInDate < b.checkOutDate && b.checkInDate < a.checkOutDate) {
      dupOf.set(a.id, [...(dupOf.get(a.id) ?? []), b.code]); dupOf.set(b.id, [...(dupOf.get(b.id) ?? []), a.code]);
    }
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Woodpecker PMS audit";
  const sheet = (name: string, cols: { header: string; key: string; width?: number }[]) => {
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = cols.map((c) => ({ ...c, width: c.width ?? 14 }));
    ws.getRow(1).font = { bold: true };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    return ws;
  };

  // Summary is created first so it is the first tab; it is filled at the end.
  const wsS = sheet("Summary", [{ header: "Item", key: "k", width: 40 }, { header: "Value", key: "v", width: 24 }]);
  const flags: { code: string; property: string; guest: string; flag: string; detail: string }[] = [];
  const guestAgg = new Map<string, { stays: number; nights: number; billed: number; paid: number; first: string; last: string; props: Set<string>; codes: string[] }>();

  const wsB = sheet("Bookings", [
    { header: "Booking", key: "code", width: 14 }, { header: "Property", key: "prop", width: 18 }, { header: "Guest", key: "guest", width: 30 },
    { header: "Mobile (masked)", key: "mob", width: 14 }, { header: "Status", key: "status", width: 12 }, { header: "Source", key: "src", width: 12 },
    { header: "Booked on", key: "booked" }, { header: "Arrival", key: "ci" }, { header: "Departure", key: "co" }, { header: "Nights", key: "n", width: 7 },
    { header: "Rooms (with dates)", key: "rooms", width: 34 }, { header: "Rate/night ₹ (pre-tax)", key: "rate" },
    { header: "Room charges ₹", key: "room" }, { header: "Other charges ₹", key: "other" }, { header: "Discounts ₹", key: "disc" },
    { header: "Taxable ₹", key: "taxable" }, { header: "GST ₹", key: "gst" }, { header: "Bill total ₹", key: "total" },
    { header: "Paid ₹", key: "paid" }, { header: "Balance ₹", key: "bal" }, { header: "Payments", key: "pays", width: 40 },
    { header: "Active invoice(s)", key: "inv", width: 26 }, { header: "Invoice total ₹", key: "invTotal" }, { header: "Credit notes", key: "cn", width: 22 },
    { header: "Transferred from", key: "xfer" }, { header: "Flags", key: "flags", width: 50 },
  ]);

  for (const r of res) {
    const lines = r.folio?.lines ?? [];
    const reversed = new Set(lines.filter((l) => l.reversalOfId).map((l) => l.reversalOfId));
    const act = lines.filter((l) => l.type !== "REVERSAL" && !reversed.has(l.id));
    const tot = (ls: typeof lines) => ls.reduce((s, l) => s + Number(l.amountPaise) + l.cgstPaise + l.sgstPaise + l.igstPaise, 0);
    const room = act.filter((l) => l.type === "ROOM").reduce((s, l) => s + Number(l.amountPaise), 0);
    const disc = act.filter((l) => l.type === "DISCOUNT").reduce((s, l) => s + Number(l.amountPaise), 0);
    const other = act.filter((l) => !["ROOM", "DISCOUNT"].includes(l.type)).reduce((s, l) => s + Number(l.amountPaise), 0);
    const taxable = act.reduce((s, l) => s + Number(l.amountPaise), 0);
    const gst = act.reduce((s, l) => s + l.cgstPaise + l.sgstPaise + l.igstPaise, 0);
    const total = tot(lines);
    const pays = r.folio?.payments ?? [];
    const paid = pays.reduce((s, p) => s + (p.isRefund ? -Number(p.amountPaise) : Number(p.amountPaise)), 0);
    const bal = total - paid;
    const invs = r.folio?.invoices ?? [];
    const voided = new Set(invs.filter((i) => i.cancelsInvoiceId).map((i) => i.cancelsInvoiceId));
    const activeInv = invs.filter((i) => i.type === "TAX_INVOICE" && !voided.has(i.id));
    const cns = invs.filter((i) => i.type === "CREDIT_NOTE");
    const invTotal = activeInv.reduce((s, i) => s + Number(i.totalPaise), 0);

    const f: string[] = [];
    const isStay = r.status === "CHECKED_OUT" || r.status === "IN_HOUSE";
    if (!r.externalHotelName && r.allocations.length === 0 && r.status !== "CANCELLED" && r.status !== "NO_SHOW") f.push("NO ROOM");
    if (isStay && room <= 0) f.push("NO ROOM CHARGE");
    if (r.status === "CHECKED_OUT" && Math.abs(bal) > 99) f.push(bal > 0 ? `OWED ₹${rs(bal)}` : `CREDIT ₹${rs(-bal)}`);
    if (r.status === "CHECKED_OUT" && act.length > 0 && activeInv.length === 0) f.push("NO INVOICE");
    if (activeInv.length > 1) f.push(`${activeInv.length} ACTIVE INVOICES`);
    if (activeInv.length === 1 && Math.abs(invTotal - (total)) > 99) f.push(`INVOICE ₹${rs(invTotal)} ≠ BILL ₹${rs(total)}`);
    if (dupOf.has(r.id)) f.push(`POSSIBLE DUPLICATE of ${dupOf.get(r.id)!.join(", ")}`);
    if (r.needsAttention) f.push(`NEEDS ATTENTION: ${r.needsAttention}`);
    for (const x of f) flags.push({ code: r.code, property: pname.get(r.propertyId) ?? "", guest: r.guest.fullName, flag: x.split(" ").slice(0, 3).join(" "), detail: x });

    wsB.addRow({
      code: r.code, prop: r.externalHotelName ? `Off-site: ${r.externalHotelName}` : pname.get(r.propertyId), guest: r.guest.fullName,
      mob: maskMobile(decryptOptional(r.guest.mobile)) ?? "", status: r.status, src: SRC[r.source] ?? r.source,
      booked: day(r.createdAt), ci: day(r.checkInDate), co: day(r.checkOutDate), n: r.nights,
      rooms: r.allocations.map((a) => `${a.room.number} (${a.room.category.name}) ${day(a.startDate)}→${day(a.endDate)}`).join("; "),
      rate: rs(r.ratePaise), room: rs(room), other: rs(other), disc: rs(disc), taxable: rs(taxable), gst: rs(gst), total: rs(total),
      paid: rs(paid), bal: rs(bal),
      pays: pays.map((p) => `${day(p.receivedAt)} ${p.mode}${p.isRefund ? " REFUND" : ""} ₹${rs(p.amountPaise)}`).join("; "),
      inv: activeInv.map((i) => i.number).join(", "), invTotal: activeInv.length ? rs(invTotal) : "",
      cn: cns.map((i) => i.number).join(", "), xfer: r.transferredFromId ? codeById.get(r.transferredFromId) ?? "" : "", flags: f.join(" | "),
    });

    if (r.status !== "CANCELLED" && r.status !== "NO_SHOW") {
      const g = guestAgg.get(r.guestId) ?? { stays: 0, nights: 0, billed: 0, paid: 0, first: day(r.checkInDate), last: day(r.checkOutDate), props: new Set<string>(), codes: [] };
      g.stays += 1; g.nights += r.nights; g.billed += total; g.paid += paid; g.props.add(pname.get(r.propertyId) ?? "");
      g.codes.push(r.code);
      if (day(r.checkInDate) < g.first) g.first = day(r.checkInDate);
      if (day(r.checkOutDate) > g.last) g.last = day(r.checkOutDate);
      guestAgg.set(r.guestId, g);
    }
  }

  // Invoices
  const wsI = sheet("Invoices", [
    { header: "Invoice no.", key: "no", width: 22 }, { header: "Type", key: "type", width: 13 }, { header: "Issued", key: "date" },
    { header: "Property", key: "prop", width: 18 }, { header: "Booking", key: "code" }, { header: "Customer (on invoice)", key: "cust", width: 30 },
    { header: "Customer GSTIN", key: "gstin", width: 17 }, { header: "Taxable ₹", key: "tx" }, { header: "CGST ₹", key: "c" }, { header: "SGST ₹", key: "s" },
    { header: "IGST ₹", key: "i" }, { header: "Total ₹", key: "t" }, { header: "Cancels", key: "cancels", width: 22 }, { header: "State", key: "state", width: 16 },
  ]);
  const allInv = res.flatMap((r) => (r.folio?.invoices ?? []).map((i) => ({ r, i })));
  const numById = new Map(allInv.map(({ i }) => [i.id, i.number]));
  const voidedAll = new Set(allInv.filter(({ i }) => i.cancelsInvoiceId).map(({ i }) => i.cancelsInvoiceId));
  for (const { r, i } of allInv.sort((a, b) => a.i.issuedAt.getTime() - b.i.issuedAt.getTime())) {
    wsI.addRow({ no: i.number, type: i.type, date: day(i.issuedAt), prop: pname.get(r.propertyId), code: r.code, cust: i.customerName, gstin: i.customerGstin ?? "",
      tx: rs(i.taxableValuePaise), c: rs(i.cgstPaise), s: rs(i.sgstPaise), i: rs(i.igstPaise), t: rs(i.totalPaise),
      cancels: i.cancelsInvoiceId ? numById.get(i.cancelsInvoiceId) ?? "" : "", state: i.type === "CREDIT_NOTE" ? "credit note" : voidedAll.has(i.id) ? "cancelled" : "ACTIVE" });
  }

  // Payments
  const wsP = sheet("Payments", [
    { header: "Date", key: "date" }, { header: "Property", key: "prop", width: 18 }, { header: "Booking", key: "code" }, { header: "Guest", key: "guest", width: 30 },
    { header: "Mode", key: "mode", width: 15 }, { header: "Received / Refund", key: "dir", width: 10 }, { header: "Amount ₹", key: "amt" }, { header: "Reference", key: "ref", width: 40 },
  ]);
  for (const r of res) for (const p of r.folio?.payments ?? [])
    wsP.addRow({ date: day(p.receivedAt), prop: pname.get(r.propertyId), code: r.code, guest: r.guest.fullName, mode: p.mode, dir: p.isRefund ? "REFUND" : "received", amt: rs(p.amountPaise), ref: p.reference ?? "" });

  // Guests
  const guests = await prisma.guest.findMany({ where: { deletedAt: null }, select: { id: true, fullName: true, mobile: true, email: true, city: true, state: true, country: true, nationality: true, companyName: true, gstNumber: true, createdAt: true } });
  const wsG = sheet("Guests", [
    { header: "Guest", key: "name", width: 30 }, { header: "Mobile (masked)", key: "mob", width: 14 }, { header: "Email (masked)", key: "email", width: 22 },
    { header: "City", key: "city" }, { header: "State", key: "state" }, { header: "Country", key: "country" }, { header: "Nationality", key: "nat" },
    { header: "Company", key: "co", width: 20 }, { header: "GSTIN", key: "gstin", width: 17 }, { header: "Stays", key: "stays", width: 7 }, { header: "Nights", key: "nights", width: 7 },
    { header: "First stay", key: "first" }, { header: "Last stay", key: "last" }, { header: "Billed ₹", key: "billed" }, { header: "Paid ₹", key: "paid" },
    { header: "Outstanding ₹", key: "out" }, { header: "Properties", key: "props", width: 30 }, { header: "Bookings", key: "codes", width: 40 }, { header: "Profile created", key: "created" },
  ]);
  for (const g of guests.sort((a, b) => a.fullName.localeCompare(b.fullName))) {
    const a = guestAgg.get(g.id);
    wsG.addRow({ name: g.fullName, mob: maskMobile(decryptOptional(g.mobile)) ?? "", email: maskEmail(decryptOptional(g.email)) ?? "", city: g.city ?? "", state: g.state ?? "", country: g.country ?? "", nat: g.nationality ?? "",
      co: g.companyName ?? "", gstin: g.gstNumber ?? "", stays: a?.stays ?? 0, nights: a?.nights ?? 0, first: a?.first ?? "", last: a?.last ?? "",
      billed: a ? rs(a.billed) : 0, paid: a ? rs(a.paid) : 0, out: a ? rs(a.billed - a.paid) : 0, props: a ? [...a.props].join(", ") : "", codes: a?.codes.join(", ") ?? "", created: day(g.createdAt) });
  }

  // Rooms — current occupant, next booking, free-from
  const rooms = await prisma.room.findMany({ where: { isActive: true }, select: { id: true, number: true, status: true, propertyId: true, category: { select: { name: true } } }, orderBy: [{ propertyId: "asc" }, { number: "asc" }] });
  const wsR = sheet("Rooms", [
    { header: "Property", key: "prop", width: 18 }, { header: "Room", key: "room", width: 8 }, { header: "Type", key: "type", width: 16 }, { header: "Board status", key: "status", width: 16 },
    { header: "Occupied now by", key: "now", width: 34 }, { header: "Free from", key: "free" }, { header: "Next booking", key: "next", width: 40 }, { header: "Upcoming bookings", key: "count", width: 9 },
  ]);
  for (const room of rooms) {
    if (props.find((p) => p.id === room.propertyId)?.isCostCenter) continue;
    const allocs = await prisma.roomAllocation.findMany({ where: { roomId: room.id, endDate: { gt: today }, reservation: { status: { in: ["ENQUIRY", "CONFIRMED", "IN_HOUSE"] } } }, select: { startDate: true, endDate: true, reservation: { select: { code: true, status: true, guest: { select: { fullName: true } } } } }, orderBy: { startDate: "asc" } });
    const cur = allocs.find((a) => a.startDate <= today);
    // Free from = end of the contiguous chain starting now.
    let free = today;
    for (const a of allocs) { if (a.startDate <= free) { if (a.endDate > free) free = a.endDate; } else break; }
    const next = allocs.find((a) => a.startDate > today);
    wsR.addRow({ prop: pname.get(room.propertyId), room: room.number, type: room.category.name, status: room.status,
      now: cur ? `${cur.reservation.guest.fullName} (${cur.reservation.code}, ${cur.reservation.status}) until ${day(cur.endDate)}` : "",
      free: day(free), next: next ? `${day(next.startDate)}→${day(next.endDate)} ${next.reservation.guest.fullName} (${next.reservation.code})` : "", count: allocs.filter((a) => a.startDate > today).length });
  }

  // Flags + Summary
  const wsF = sheet("Flags", [{ header: "Booking", key: "code" }, { header: "Property", key: "property", width: 18 }, { header: "Guest", key: "guest", width: 30 }, { header: "Flag", key: "detail", width: 60 }]);
  for (const x of flags) wsF.addRow(x);
  wsS.addRow({ k: "Generated", v: new Date().toISOString() });
  wsS.addRow({ k: "Bookings (all statuses)", v: res.length });
  for (const st of ["ENQUIRY", "CONFIRMED", "IN_HOUSE", "CHECKED_OUT", "CANCELLED", "NO_SHOW"]) wsS.addRow({ k: `  ${st}`, v: res.filter((r) => r.status === st).length });
  wsS.addRow({ k: "Guests (active profiles)", v: guests.length });
  wsS.addRow({ k: "Invoices (all, incl. credit notes)", v: allInv.length });
  wsS.addRow({ k: "Payments rows", v: res.reduce((s, r) => s + (r.folio?.payments.length ?? 0), 0) });
  wsS.addRow({ k: "Rooms (hotels)", v: rooms.filter((x) => !props.find((p) => p.id === x.propertyId)?.isCostCenter).length });
  // Exact for "NO ROOM" (it is also a prefix of "NO ROOM CHARGE"); prefix for the rest.
  const cnt = (prefix: string) => flags.filter((x) => (prefix === "NO ROOM" ? x.detail === "NO ROOM" : x.detail.startsWith(prefix))).length;
  for (const [k, p] of [["Flag: no room assigned", "NO ROOM"], ["Flag: no room charge on bill", "NO ROOM CHARGE"], ["Flag: still owed after checkout", "OWED"], ["Flag: guest credit after checkout", "CREDIT"], ["Flag: checked out, no invoice", "NO INVOICE"], ["Flag: invoice ≠ bill", "INVOICE"], ["Flag: possible duplicate booking", "POSSIBLE DUPLICATE"]] as const) wsS.addRow({ k, v: cnt(p) });

  await wb.xlsx.writeFile(OUT);
  console.log(`Wrote ${OUT}`);
  console.log(`Bookings ${res.length} · Invoices ${allInv.length} · Guests ${guests.length} · Flags ${flags.length}`);
}
main().catch((e) => { console.error("FAILED:", e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
