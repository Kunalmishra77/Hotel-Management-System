/**
 * PHASE A — make each stay that has a real paper bill (WASPL:803–836, photos in
 * woodpecker.zip) match that bill exactly: guest name, rooms/dates, room-nights,
 * food/extras, total and payments (mode, amount, date).
 *
 * Client/CA instruction (29 Oct 2026, before go-live on 30 Oct): the paper bills
 * are the truth. Corrections are APPEND-ONLY (the portal's own mechanism — no
 * trigger is touched): every active charge on the folio is cancelled by a REVERSAL
 * line and the paper's lines are posted; payments that differ from the paper are
 * refunded out and the paper's payments recorded (the bill view hides cancelled
 * pairs). A full backup was taken first (scratchpad/backup-before-paper-2026-10-29.json).
 *
 * Invoices are NOT issued here — PHASE B (rebuild-invoice-register.ts) issues each
 * stay's invoice with its paper number and date.
 *   npx tsx scripts/conform-paper-bills.ts                      (dry-run)
 *   $env:CONFIRM="YES"; npx tsx scripts/conform-paper-bills.ts  (apply)
 *   $env:ONLY="818,825"                                         (subset)
 */
import "dotenv/config";
import { PrismaClient, type Prisma, type PaymentMode, type ChargeType } from "@prisma/client";
import { runWithSystemContext } from "../src/lib/context";
import { computeGst } from "../src/features/billing/domain/gst";
import { roomGstBps } from "../src/lib/constants/gst";
import { recomputeHistoricalSnapshot } from "../src/features/analytics/night-audit";
import { PAPER_BILLS, type PaperBill } from "./paper-bills";

const APPLY = process.env.CONFIRM === "YES";
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",").map((s) => Number(s.trim()))) : null;
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const P = (rupees: number) => Math.round(rupees * 100);
const inr = (p: bigint | number) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const noon = (s: string) => new Date(`${s}T06:30:00.000Z`); // 12:00 IST
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const nightsOf = (from: string, to: string) => {
  const out: string[] = [];
  for (let t = day(from).getTime(); t < day(to).getTime(); t += 86_400_000) out.push(ymd(new Date(t)));
  return out;
};
const EXTRA_BPS = 500; // the paper bills charge 2.5% + 2.5% on food / extras too

const RES_SEL = {
  id: true, code: true, status: true, propertyId: true, guestId: true, checkInDate: true, checkOutDate: true, nights: true, ratePaise: true, source: true,
  guest: { select: { fullName: true } },
  property: { select: { orgId: true, state: true, code: true } },
  allocations: { select: { id: true, roomId: true, startDate: true, endDate: true, room: { select: { number: true } } } },
  folio: {
    select: {
      id: true,
      lines: { select: { id: true, type: true, amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, reversalOfId: true } },
      payments: { select: { id: true, mode: true, amountPaise: true, isRefund: true, receivedAt: true, reference: true } },
      invoices: { select: { id: true, number: true } },
    },
  },
} as const;
type Res = Prisma.ReservationGetPayload<{ select: typeof RES_SEL }>;

const folioTotal = (r: Res) => (r.folio?.lines ?? []).reduce((s, l) => s + l.amountPaise + BigInt(l.cgstPaise + l.sgstPaise + l.igstPaise), 0n);
const netPays = (r: Res) => (r.folio?.payments ?? []).reduce((s, p) => s + (p.isRefund ? -p.amountPaise : p.amountPaise), 0n);
const payText = (r: Res) => (r.folio?.payments ?? []).map((p) => `${p.isRefund ? "-" : ""}${p.mode} ${inr(p.amountPaise)}`).join(", ") || "none";

/** The lines the paper bill lists, as folio-line rows (GST computed like the portal does). */
function paperLines(b: PaperBill, folioId: string, state: string, base = new Map<string, number>()) {
  const rows: Prisma.FolioLineCreateManyInput[] = [];
  const perNight = new Map(base);
  for (const n of b.nights) {
    for (const date of nightsOf(n.from, n.to)) {
      for (let i = 0; i < (n.rooms ?? 1); i++) {
        const ratePaise = P(n.rate);
        const bps = roomGstBps(ratePaise);
        const g = computeGst(ratePaise, bps, state, state);
        const revision = perNight.get(date) ?? 0;
        perNight.set(date, revision + 1);
        rows.push({
          folioId, type: "ROOM", description: n.desc ?? "Room charge", quantity: 1, unitPaise: ratePaise, amountPaise: BigInt(ratePaise),
          taxRateBps: bps, cgstPaise: g.cgstPaise, sgstPaise: g.sgstPaise, igstPaise: g.igstPaise, hsnSac: "996311",
          placeOfSupplyState: state, businessDate: day(date), revision,
        });
      }
    }
  }
  for (const x of b.extras ?? []) rows.push(extraRow(folioId, state, x));
  return rows;
}

function extraRow(folioId: string, state: string, x: { type: string; desc: string; amount: number; date: string; gross?: number }): Prisma.FolioLineCreateManyInput {
  // A GST-inclusive amount (₹500 collected) splits so taxable + CGST + SGST is exactly that.
  const grossP = x.gross !== undefined ? P(x.gross) : null;
  const amt = grossP !== null ? Math.round((grossP * 10_000) / (10_000 + EXTRA_BPS)) : P(x.amount);
  const g = grossP !== null
    ? { cgstPaise: Math.round((grossP - amt) / 2), sgstPaise: grossP - amt - Math.round((grossP - amt) / 2), igstPaise: 0 }
    : computeGst(amt, EXTRA_BPS, state, state);
  return {
    folioId, type: x.type as ChargeType, description: x.desc, quantity: 1, unitPaise: amt, amountPaise: BigInt(amt),
    taxRateBps: EXTRA_BPS, cgstPaise: g.cgstPaise, sgstPaise: g.sgstPaise, igstPaise: g.igstPaise,
    hsnSac: x.type === "FOOD" ? "996331" : "996311", placeOfSupplyState: state, businessDate: day(x.date), revision: 0,
  };
}

const lineSum = (rows: Prisma.FolioLineCreateManyInput[]) =>
  rows.reduce((s, l) => s + BigInt(l.amountPaise as bigint) + BigInt((l.cgstPaise ?? 0) + (l.sgstPaise ?? 0) + (l.igstPaise ?? 0)), 0n);

type Pay = { id: string; mode: PaymentMode; amountPaise: bigint; isRefund: boolean; receivedAt: Date; reference: string | null };

/** Payments still standing: each refund cancels one payment of the same mode + amount. */
function unpaired(pays: Pay[]): Pay[] {
  const refunds = pays.filter((p) => p.isRefund);
  return pays.filter((p) => !p.isRefund).filter((p) => {
    const i = refunds.findIndex((x) => x.mode === p.mode && x.amountPaise === p.amountPaise);
    if (i >= 0) { refunds.splice(i, 1); return false; }
    return true;
  });
}

/** Cancel every active charge with a REVERSAL line (append-only). */
async function reverseCharges(tx: Prisma.TransactionClient, folioId: string, why: string) {
  const ls = await tx.folioLine.findMany({ where: { folioId }, select: { id: true, type: true, description: true, unitPaise: true, amountPaise: true, taxRateBps: true, cgstPaise: true, sgstPaise: true, igstPaise: true, hsnSac: true, placeOfSupplyState: true, reversalOfId: true } });
  const reversed = new Set(ls.filter((l) => l.reversalOfId).map((l) => l.reversalOfId));
  for (const l of ls.filter((x) => x.type !== "REVERSAL" && !reversed.has(x.id))) {
    await tx.folioLine.create({ data: {
      folioId, type: "REVERSAL", description: `Reversal: ${l.description} (${why})`, quantity: 1,
      unitPaise: -l.unitPaise, amountPaise: -l.amountPaise, taxRateBps: l.taxRateBps,
      cgstPaise: -l.cgstPaise, sgstPaise: -l.sgstPaise, igstPaise: -l.igstPaise,
      hsnSac: l.hsnSac, placeOfSupplyState: l.placeOfSupplyState, businessDate: new Date(), reversalOfId: l.id,
    } });
  }
}

/** Refund out every payment still standing (append-only), dated like the original. */
async function refundAll(tx: Prisma.TransactionClient, propertyId: string, folioId: string, pays: Pay[], why: string) {
  for (const p of unpaired(pays)) {
    await tx.payment.create({ data: { propertyId, folioId, mode: p.mode, amountPaise: p.amountPaise, isRefund: true, reference: why, receivedAt: p.receivedAt } });
  }
}

/** Next ROOM revision per night, after the lines already on the folio (unique index). */
async function roomRevisionBase(tx: Prisma.TransactionClient, folioId: string): Promise<Map<string, number>> {
  const ls = await tx.folioLine.findMany({ where: { folioId, type: "ROOM" }, select: { businessDate: true, revision: true } });
  const m = new Map<string, number>();
  for (const l of ls) m.set(ymd(l.businessDate), Math.max(m.get(ymd(l.businessDate)) ?? 0, l.revision + 1));
  return m;
}

async function ensureFolioId(tx: Prisma.TransactionClient, r: Res): Promise<string> {
  if (r.folio) return r.folio.id;
  const f = await tx.folio.create({ data: { propertyId: r.propertyId, reservationId: r.id }, select: { id: true } });
  return f.id;
}

async function load(code: string): Promise<Res> {
  return prisma.reservation.findFirstOrThrow({ where: { code }, select: RES_SEL });
}

async function main() {
  const bills = PAPER_BILLS.filter((b) => !ONLY || ONLY.has(b.inv));
  const touchedNights = new Map<string, Set<string>>(); // propertyId → dates to re-snapshot
  const touch = (pid: string, dates: string[]) => { const s = touchedNights.get(pid) ?? new Set<string>(); dates.forEach((d) => s.add(d)); touchedNights.set(pid, s); };

  // Dry-run only: bookings whose rooms an EARLIER bill re-plans (their current rooms won't block).
  const replanned = (await prisma.reservation.findMany({ where: { code: { in: bills.filter((x) => x.rooms).map((x) => x.code) } }, select: { id: true } })).map((x) => x.id);
  for (const b of bills) {
    const r = await load(b.code);
    const others = await Promise.all([...(b.merge ?? []), ...(b.emptyOnly ?? []), ...(b.clearAllocsOf ?? [])].map(load));
    const side = b.side ? await load(b.side.code) : null;
    const state = r.property.state;
    const rows = paperLines(b, "x", state);
    const onInvoice = lineSum(rows);
    const offRows = (b.offInvoice ?? []).map((x) => extraRow("x", state, x));
    const roundOff = P(b.total) - Number(onInvoice);
    if (Math.abs(roundOff) > 200) throw new Error(`#${b.inv} ${b.code}: paper total ₹${b.total} vs lines ${inr(onInvoice)} — round-off ${roundOff} paise too big; check the spec`);
    const targetFolio = BigInt(P(b.total)) + lineSum(offRows);
    const targetPays = b.payments ? b.payments.reduce((s, p) => s + P(p.amount), 0) : null;

    console.log(`\n#${b.inv} ${b.code} @${r.property.code} [${r.status}] ${r.guest.fullName}${b.guestName && b.guestName !== r.guest.fullName ? ` → "${b.guestName}"` : ""}`);
    console.log(`   now : ${ymd(r.checkInDate)}→${ymd(r.checkOutDate)} rooms ${r.allocations.map((a) => `${a.room.number}(${ymd(a.startDate).slice(5)}→${ymd(a.endDate).slice(5)})`).join(" ") || "none"} · bill ${inr(folioTotal(r))} · paid ${inr(netPays(r))} [${payText(r)}] · invoices ${r.folio?.invoices.map((i) => i.number.replace(/\s/g, "")).join(", ") || "none"}`);
    console.log(`   bill: ${b.stay ? `${b.stay.from}→${b.stay.to} ` : ""}${b.rooms ? `rooms ${b.rooms.map((x) => `${x.n}(${x.from.slice(5)}→${x.to.slice(5)})`).join(" ")} ` : ""}lines ${inr(onInvoice)}${roundOff ? ` round-off ${roundOff > 0 ? "+" : ""}${roundOff / 100}` : ""} = ${inr(P(b.total))}${offRows.length ? ` + off-invoice ${inr(lineSum(offRows))}` : ""} · pay ${b.payments ? b.payments.map((p) => `${p.mode} ₹${p.amount}${p.date ? ` (${p.date.slice(5)})` : ""}`).join(" + ") || "none (on credit)" : "unchanged"}${targetPays !== null ? ` → balance ${inr(targetFolio - BigInt(targetPays))}` : ""}`);
    for (const o of others) console.log(`   also: ${o.code} @${o.property.code} bill ${inr(folioTotal(o))} paid ${inr(netPays(o))} → ${b.merge?.includes(o.code) ? "merged in (emptied, room moved here, booking closed)" : b.emptyOnly?.includes(o.code) ? "emptied (its money now on this bill)" : "allocations cleared for the re-plan"}`);
    if (side) console.log(`   side: ${side.code} bill ${inr(folioTotal(side))} [${payText(side)}] → ${b.side!.extras.map((x) => (x.gross ? `${x.desc} ₹${x.gross} incl. GST` : `${x.desc} ₹${x.amount}+GST`)).join(", ")} · pay ${b.side!.payments.map((p) => `${p.mode} ₹${p.amount}`).join(" + ")} (no invoice — off the paper bill)`);
    if (b.note) console.log(`   note: ${b.note}`);
    // Would the new room plan collide with another guest? (The exclusion constraint would refuse it.)
    for (const a of b.rooms ?? []) {
      const room = await prisma.room.findFirst({ where: { propertyId: r.propertyId, number: a.n }, select: { id: true } });
      if (!room) throw new Error(`#${b.inv}: room ${a.n} not found at ${r.property.code}`);
      const clash = await prisma.roomAllocation.findFirst({
        where: { roomId: room.id, reservationId: { notIn: [r.id, ...others.map((o) => o.id), ...(APPLY ? [] : replanned)] }, startDate: { lt: day(a.to) }, endDate: { gt: day(a.from) } },
        select: { reservation: { select: { code: true, guest: { select: { fullName: true } } } }, startDate: true, endDate: true },
      });
      if (clash) throw new Error(`#${b.inv}: ${a.n} ${a.from}→${a.to} is taken by ${clash.reservation.code} ${clash.reservation.guest.fullName} (${ymd(clash.startDate)}→${ymd(clash.endDate)})`);
    }
    if (!APPLY) continue;

    const orgId = r.property.orgId;
    await runWithSystemContext(orgId, async () => {
      await prisma.$transaction(async (tx) => {

        // Name.
        if (b.guestName && b.guestName !== r.guest.fullName) {
          await tx.guest.update({ where: { id: r.guestId }, data: { fullName: b.guestName } });
        }

        // Other bookings: merged in / emptied / allocations cleared.
        for (const o of others) {
          if (b.clearAllocsOf?.includes(o.code)) { await tx.roomAllocation.deleteMany({ where: { reservationId: o.id } }); continue; }
          if (o.folio) {
            await reverseCharges(tx, o.folio.id, `now on ${r.code} bill - paper #${b.inv}`);
            await refundAll(tx, o.propertyId, o.folio.id, o.folio.payments, `Moved to ${r.code} (paper invoice #${b.inv})`);
          }
          if (b.merge?.includes(o.code)) {
            if (!b.rooms) await tx.roomAllocation.updateMany({ where: { reservationId: o.id }, data: { reservationId: r.id } });
            else await tx.roomAllocation.deleteMany({ where: { reservationId: o.id } });
            await tx.reservation.update({ where: { id: o.id }, data: { status: "CANCELLED", notes: `Merged into ${r.code} — one bill (paper invoice #${b.inv})` } });
          }
          touch(o.propertyId, nightsOf(ymd(o.checkInDate), ymd(o.checkOutDate)));
        }

        // Rooms / dates.
        if (b.rooms) {
          await tx.roomAllocation.deleteMany({ where: { reservationId: r.id } });
          for (const a of b.rooms) {
            const room = await tx.room.findFirstOrThrow({ where: { propertyId: r.propertyId, number: a.n }, select: { id: true } });
            await tx.roomAllocation.create({ data: { propertyId: r.propertyId, reservationId: r.id, roomId: room.id, startDate: day(a.from), endDate: day(a.to) } });
          }
        }
        const stayFrom = b.stay?.from ?? ymd(r.checkInDate);
        const stayTo = b.stay?.to ?? ymd(r.checkOutDate);
        const firstRate = P(b.nights[0]!.rate);
        await tx.reservation.update({
          where: { id: r.id },
          data: {
            checkInDate: day(stayFrom), checkOutDate: day(stayTo), nights: Math.max(1, nightsOf(stayFrom, stayTo).length), ratePaise: firstRate,
            ...(b.source ? { source: b.source as never } : {}),
          },
        });
        touch(r.propertyId, [...nightsOf(ymd(r.checkInDate), ymd(r.checkOutDate)), ...nightsOf(stayFrom, stayTo)]);

        // Folio: wipe, then the paper's lines + round-off + off-invoice extras.
        const folioId = await ensureFolioId(tx, r);
        await reverseCharges(tx, folioId, `corrected to paper invoice #${b.inv}`);
        const lines = [...paperLines(b, folioId, state, await roomRevisionBase(tx, folioId))];
        if (roundOff !== 0) lines.push({ folioId, type: "MISC", description: "Round off", quantity: 1, unitPaise: roundOff, amountPaise: BigInt(roundOff), taxRateBps: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, hsnSac: null, placeOfSupplyState: state, businessDate: day(nightsOf(stayFrom, stayTo).at(-1) ?? stayFrom), revision: 0 });
        for (const x of b.offInvoice ?? []) lines.push(extraRow(folioId, state, x));
        await tx.folioLine.createMany({ data: lines });

        // Payments: when the paper's list differs from what stands, refund the old ones
        // out and record the paper's (dated like the original where mode + amount match).
        if (b.payments) {
          const standing = unpaired(r.folio?.payments ?? []);
          const key = (m: string, a: bigint) => `${m}:${a}`;
          const want = b.payments.map((p) => key(p.mode, BigInt(P(p.amount)))).sort().join("|");
          const have = standing.map((p) => key(p.mode, p.amountPaise)).sort().join("|");
          if (want !== have) {
            await refundAll(tx, r.propertyId, folioId, r.folio?.payments ?? [], `Corrected to paper invoice #${b.inv}`);
            for (const p of b.payments) {
              const prior = standing.find((x) => x.mode === p.mode && x.amountPaise === BigInt(P(p.amount)));
              await tx.payment.create({ data: {
                propertyId: r.propertyId, folioId, mode: p.mode as PaymentMode, amountPaise: BigInt(P(p.amount)),
                reference: p.ref ?? prior?.reference ?? `Paper invoice #${b.inv}`,
                receivedAt: p.date ? noon(p.date) : (prior?.receivedAt ?? noon(stayTo)),
              } });
            }
          }
        }

        // Side booking holding a charge collected off the paper bill.
        if (side && b.side) {
          const sfid = await ensureFolioId(tx, side);
          await reverseCharges(tx, sfid, `re-entered per paper #${b.inv} note`);
          await refundAll(tx, side.propertyId, sfid, side.folio?.payments ?? [], `Corrected per paper #${b.inv} note`);
          await tx.folioLine.createMany({ data: b.side.extras.map((x) => extraRow(sfid, side.property.state, x)) });
          for (const p of b.side.payments) {
            await tx.payment.create({ data: { propertyId: side.propertyId, folioId: sfid, mode: p.mode as PaymentMode, amountPaise: BigInt(P(p.amount)), reference: p.ref ?? `Collected separately (paper invoice #${b.inv} note)`, receivedAt: noon(p.date ?? ymd(side.checkOutDate)) } });
          }
          if (b.side.guestName) await tx.guest.update({ where: { id: side.guestId }, data: { fullName: b.side.guestName } });
        }

        await tx.domainEvent.create({ data: { orgId, propertyId: r.propertyId, type: "ReservationModified", aggregateId: r.id, payload: { conformedToPaperInvoice: b.inv } } });
        await tx.auditLog.create({ data: {
          orgId, propertyId: r.propertyId, action: "reservation:conform-paper-bill", entityType: "Reservation", entityId: r.id,
          reason: `Pre-go-live correction (client/CA, 29 Oct 2026): stay corrected to match paper tax invoice WASPL:${b.inv} (append-only) — script`,
          before: { guest: r.guest.fullName, bill: inr(folioTotal(r)), paid: inr(netPays(r)), payments: payText(r), invoices: r.folio?.invoices.map((i) => i.number) ?? [] },
          after: { guest: b.guestName ?? r.guest.fullName, bill: inr(targetFolio), payments: b.payments?.map((p) => `${p.mode} ₹${p.amount}`) ?? "kept" },
        } });
      }, { maxWait: 20_000, timeout: 120_000 });
    });

    const x = await load(b.code);
    const bal = folioTotal(x) - netPays(x);
    console.log(`   ✅ now ${ymd(x.checkInDate)}→${ymd(x.checkOutDate)} rooms ${x.allocations.map((a) => a.room.number).join("+") || "none"} · bill ${inr(folioTotal(x))} · paid ${inr(netPays(x))} · balance ${inr(bal)}`);
  }

  if (APPLY) {
    console.log("\nRefreshing daily stats for the touched nights…");
    for (const [pid, dates] of touchedNights) {
      const orgId = (await prisma.property.findUniqueOrThrow({ where: { id: pid }, select: { orgId: true } })).orgId;
      await runWithSystemContext(orgId, async () => {
        for (const d of [...dates].sort()) { try { await recomputeHistoricalSnapshot(pid, day(d)); } catch (e) { console.log(`   snapshot ${d}: ${(e as Error).message}`); } }
      });
    }
  } else {
    console.log("\nDRY RUN — nothing written. Re-run with CONFIRM=YES to apply.");
  }
}
main().catch((e) => { console.error("Failed:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
