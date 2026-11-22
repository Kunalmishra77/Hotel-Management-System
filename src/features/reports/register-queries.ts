/**
 * Detailed registers for Reports (client, 22 Nov 2026: "last month — how many
 * bookings, who were they, track everything easily").
 *
 *  - bookingRegister: one row per booking with the money that matters — bill
 *    (charges + GST, from the folio), paid, balance, invoice numbers — chosen by
 *    check-in date, by any night inside the period, or by booked-on date.
 *  - collectionsRegister: every payment / refund received in the period (the cash
 *    book), with who received it, for evening cash reconciliation.
 * Money is read from the folio (the source of truth), never re-estimated.
 * `report:view-financial`, property-scoped.
 */
import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { localDayInstants } from "@/lib/local-day";
import { activeLines, lineSource, OTA_SOURCES } from "@/features/billing";
import { DEFAULT_DEDUCTION, type DeductionRule } from "./domain/ota-deduction";
import type { SessionClaims } from "@/lib/auth/claims";

export type RegisterBasis = "checkin" | "stay" | "booked";

export type BookingRegisterEntry = {
  reservationId: string;
  code: string;
  propertyId: string;
  guestName: string;
  company: string | null;
  rooms: string;
  source: string;
  status: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  bookedOn: string;
  ratePaise: number;
  /** Charges ex-tax (net of discounts) on the folio. */
  chargesPaise: number;
  taxPaise: number;
  billPaise: number;
  paidPaise: number;
  balancePaise: number;
  invoices: string;
  /** The OTA-sold part of the stay, per channel (its nights' charges ex-GST + GST) — what commission applies to. */
  otaParts: { source: string; basePaise: number; gstPaise: number }[];
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export async function bookingRegister(
  user: SessionClaims,
  input: { propertyIds: string[]; from: Date; to: Date; basis: RegisterBasis },
): Promise<BookingRegisterEntry[]> {
  authorize(user, "report:view-financial", input.propertyIds[0] ?? null);
  const scoped = db.scoped(user);
  // @db.Date columns hold UTC-midnight dates; `from`/`to` are local days at UTC midnight.
  const where =
    input.basis === "stay" ? { checkInDate: { lte: input.to }, checkOutDate: { gt: input.from } }
    : input.basis === "booked" ? { createdAt: { gte: localDayInstants(input.from).start, lt: localDayInstants(input.to).next } }
    : { checkInDate: { gte: input.from, lte: input.to } };
  const rows = await scoped.reservation.findMany({
    where: { propertyId: { in: input.propertyIds }, ...where },
    select: {
      id: true, propertyId: true, code: true, status: true, source: true, checkInDate: true, checkOutDate: true,
      nights: true, ratePaise: true, createdAt: true,
      extensions: { select: { fromDate: true, toDate: true, source: true } },
      guest: { select: { fullName: true, companyName: true } },
      allocations: { select: { room: { select: { number: true } } }, orderBy: { startDate: "asc" } },
      folio: {
        select: {
          lines: { select: { id: true, type: true, description: true, amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, businessDate: true, revision: true, reversalOfId: true } },
          payments: { select: { amountPaise: true, isRefund: true } },
          invoices: { where: { supersededById: null }, select: { id: true, number: true, type: true, cancelsInvoiceId: true } },
        },
      },
    },
    orderBy: [{ checkInDate: "asc" }, { code: "asc" }],
    take: 5000,
  });
  return rows.map((r) => {
    const lines = activeLines(r.folio?.lines ?? []);
    let charges = 0, tax = 0;
    for (const l of lines) { charges += Number(l.amountPaise); tax += l.cgstPaise + l.sgstPaise + l.igstPaise; }
    let paid = 0;
    for (const p of r.folio?.payments ?? []) paid += (p.isRefund ? -1 : 1) * Number(p.amountPaise);
    // Which channel sold each line (billing's rule — the same split as the bills).
    const all = r.folio?.lines ?? [];
    const byId = new Map(all.map((l) => [l.id, l]));
    const ctx = { bookingSource: r.source, extensions: r.extensions };
    const ota = new Map<string, { basePaise: number; gstPaise: number }>();
    for (const l of lines) {
      const s = lineSource(l, byId, ctx);
      if (!OTA_SOURCES.has(s)) continue;
      const acc = ota.get(s) ?? { basePaise: 0, gstPaise: 0 };
      acc.basePaise += Number(l.amountPaise); acc.gstPaise += l.cgstPaise + l.sgstPaise + l.igstPaise;
      ota.set(s, acc);
    }
    const invs = r.folio?.invoices ?? [];
    const credited = new Set(invs.map((i) => i.cancelsInvoiceId).filter(Boolean));
    const liveNumbers = invs.filter((i) => i.type === "TAX_INVOICE" && !credited.has(i.id)).map((i) => i.number.replace("WASPL :", "").replace(/\/ \d\d-\d\d$/, ""));
    return {
      reservationId: r.id, code: r.code, propertyId: r.propertyId, guestName: r.guest.fullName, company: r.guest.companyName,
      rooms: [...new Set(r.allocations.map((a) => a.room.number))].join(", "),
      source: r.source, status: r.status, checkIn: ymd(r.checkInDate), checkOut: ymd(r.checkOutDate), nights: r.nights,
      bookedOn: r.createdAt.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }), ratePaise: r.ratePaise,
      chargesPaise: charges, taxPaise: tax, billPaise: charges + tax, paidPaise: paid, balancePaise: charges + tax - paid,
      invoices: liveNumbers.join(", "),
      otaParts: [...ota.entries()].map(([source, v]) => ({ source, ...v })),
    };
  });
}

export type CollectionEntry = {
  id: string;
  propertyId: string;
  at: string; // ISO instant
  day: string; // India-time YYYY-MM-DD
  mode: string;
  amountPaise: number; // negative for a refund
  reference: string | null;
  receivedBy: string;
  /** What it was for: booking code / guest, or a manual bill's customer. */
  forLabel: string;
  reservationId: string | null;
};

export async function collectionsRegister(
  user: SessionClaims,
  input: { propertyIds: string[]; from: Date; to: Date },
): Promise<CollectionEntry[]> {
  authorize(user, "report:view-financial", input.propertyIds[0] ?? null);
  const scoped = db.scoped(user);
  const pays = await scoped.payment.findMany({
    where: { propertyId: { in: input.propertyIds }, receivedAt: { gte: localDayInstants(input.from).start, lt: localDayInstants(input.to).next } },
    select: {
      id: true, propertyId: true, receivedAt: true, mode: true, amountPaise: true, isRefund: true, reference: true, receivedById: true,
      folio: { select: { kind: true, reservation: { select: { id: true, code: true, guest: { select: { fullName: true } } } }, invoices: { where: { supersededById: null, type: "TAX_INVOICE" }, select: { customerName: true }, take: 1 } } },
    },
    orderBy: { receivedAt: "asc" },
    take: 10000,
  });
  const userIds = [...new Set(pays.map((p) => p.receivedById).filter((x): x is string => !!x))];
  const users = userIds.length ? await scoped.user.findMany({ where: { id: { in: userIds }, orgId: user.orgId }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return pays.map((p) => {
    const res = p.folio.reservation;
    const forLabel = res ? `${res.code} · ${res.guest.fullName}`
      : p.folio.kind === "MANUAL" ? `Manual bill · ${p.folio.invoices[0]?.customerName ?? "customer"}`
      : p.folio.kind === "DIRECT_SALE" ? "Walk-in sale" : "—";
    return {
      id: p.id, propertyId: p.propertyId, at: p.receivedAt.toISOString(),
      day: p.receivedAt.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
      mode: p.mode, amountPaise: (p.isRefund ? -1 : 1) * Number(p.amountPaise), reference: p.reference,
      receivedBy: (p.receivedById && nameOf.get(p.receivedById)) || "—", forLabel, reservationId: res?.id ?? null,
    };
  });
}

/** Each OTA's deduction rule (the hotel's settings, else the defaults). */
export async function channelDeductionRules(user: SessionClaims): Promise<Record<string, DeductionRule & { set: boolean }>> {
  const rows = await db.scoped(user).channelDeduction.findMany({ where: { orgId: user.orgId } });
  const out: Record<string, DeductionRule & { set: boolean }> = {};
  for (const s of OTA_SOURCES) out[s] = { ...DEFAULT_DEDUCTION, set: false };
  for (const r of rows) {
    out[r.source] = { commissionBps: r.commissionBps, commissionOnGross: r.commissionOnGross, gstOnCommissionBps: r.gstOnCommissionBps, tcsBps: r.tcsBps, tdsBps: r.tdsBps, set: true };
  }
  return out;
}
