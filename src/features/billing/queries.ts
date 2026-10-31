/**
 * Billing queries — 06 T-23/T-25 (FR-18/24/26, AC-22/24). All figures derive from
 * folio lines/payments the SAME way (net-of-discount, tax-excluded for revenue),
 * so 08/14/05/25 reconcile to the paisa. Callers pass claims explicitly.
 */
import { db } from "@/lib/db";
import { localDayInstants, localToday } from "@/lib/local-day";
import { authorize } from "@/lib/permissions";
import { folioBalance } from "./domain/balance";
import { activeLines } from "./domain/reversal";
import { outstandingAcrossJourneys, type JourneyFolio } from "./domain/journey";
import type { SessionClaims } from "@/lib/auth/claims";

export type FolioInvoiceView = {
  id: string;
  number: string;
  type: string; // TAX_INVOICE | CREDIT_NOTE
  totalPaise: number;
  cancelsInvoiceId: string | null;
  issuedAt: Date;
  /** Bill-to on the invoice — prefills a revised bill. */
  customerName: string;
  customerGstin: string | null;
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
};

export type FolioView = {
  id: string;
  balancePaise: number;
  lines: { id: string; type: string; description: string; amountPaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; reversalOfId: string | null }[];
  payments: { id: string; mode: string; amountPaise: number; isRefund: boolean; receivedAt: string; reference: string | null }[];
  // Issued bills on this folio, oldest first — the version history (original →
  // credit note → revised). #22: lets the UI void & revise and show the chain.
  invoices: FolioInvoiceView[];
};

export async function getFolio(user: SessionClaims, folioId: string): Promise<FolioView | null> {
  const folio = await db.scoped(user).folio.findFirst({
    where: { id: folioId },
    select: {
      id: true,
      lines: { select: { id: true, type: true, description: true, amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, reversalOfId: true }, orderBy: { createdAt: "asc" } },
      payments: { select: { id: true, mode: true, amountPaise: true, isRefund: true, receivedAt: true, reference: true }, orderBy: { receivedAt: "asc" } },
      invoices: { select: { id: true, number: true, type: true, totalPaise: true, cancelsInvoiceId: true, issuedAt: true, customerName: true, customerGstin: true, taxableValuePaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true }, orderBy: { issuedAt: "asc" } },
    },
  });
  if (!folio) return null;
  const balance = folioBalance(folio.lines, folio.payments);
  return {
    id: folio.id,
    balancePaise: Number(balance),
    lines: folio.lines.map((l) => ({ ...l, amountPaise: Number(l.amountPaise) })),
    payments: folio.payments.map((p) => ({ ...p, amountPaise: Number(p.amountPaise), receivedAt: p.receivedAt.toISOString() })),
    invoices: folio.invoices.map((i) => ({ ...i, totalPaise: Number(i.totalPaise), taxableValuePaise: Number(i.taxableValuePaise) })),
  };
}

/** Full folio (lines + payments + derived balance) for a reservation — powers the
 *  complete booking-details financial breakdown. Property-scoped. */
export async function getReservationFolio(user: SessionClaims, reservationId: string): Promise<FolioView | null> {
  const folio = await db.scoped(user).folio.findFirst({
    where: { reservationId },
    select: {
      id: true,
      lines: { select: { id: true, type: true, description: true, amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, reversalOfId: true }, orderBy: { createdAt: "asc" } },
      payments: { select: { id: true, mode: true, amountPaise: true, isRefund: true, receivedAt: true, reference: true }, orderBy: { receivedAt: "asc" } },
      invoices: { select: { id: true, number: true, type: true, totalPaise: true, cancelsInvoiceId: true, issuedAt: true, customerName: true, customerGstin: true, taxableValuePaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true }, orderBy: { issuedAt: "asc" } },
    },
  });
  if (!folio) return null;
  const balance = folioBalance(folio.lines, folio.payments);
  return {
    id: folio.id,
    balancePaise: Number(balance),
    lines: folio.lines.map((l) => ({ ...l, amountPaise: Number(l.amountPaise) })),
    payments: folio.payments.map((p) => ({ ...p, amountPaise: Number(p.amountPaise), receivedAt: p.receivedAt.toISOString() })),
    invoices: folio.invoices.map((i) => ({ ...i, totalPaise: Number(i.totalPaise), taxableValuePaise: Number(i.taxableValuePaise) })),
  };
}

export type InvoiceListItem = {
  id: string;
  number: string;
  customerName: string;
  customerGstin: string | null;
  propertyName: string;
  totalPaise: number;
  issuedAt: Date;
  /** The booking whose bill this is — the picker opens its folio to void & revise. */
  reservationId: string | null;
};

/**
 * Invoice search — the 15-search federation shard for invoices (15 FR-1/2).
 * Keyword matches the invoice `number` OR the customer name; property-scoped,
 * cursor-paginated, uses the `[propertyId, issuedAt]`/`[propertyId, number]`
 * indexes. Customer name is not PII beyond what the folio already shows.
 */
export async function searchInvoices(
  user: SessionClaims,
  input: { keyword?: string; propertyId?: string; from?: Date; to?: Date; gstOnly?: boolean; cursor?: string; limit?: number },
): Promise<{ invoices: InvoiceListItem[]; nextCursor: string | null }> {
  const limit = input.limit ?? 25;
  const kw = input.keyword?.trim();
  const dateFilter = input.from || input.to
    ? { issuedAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } }
    : {};
  // Keep the operational register CLEAN: show only real, current bills. Voided tax
  // invoices (cancelled by a credit note), the credit notes themselves, and empty
  // ₹0 invoices are hidden here — they stay in the DB (GST: issued invoices are
  // permanent + gap-free) and appear in the dedicated GST register export for filing.
  const cancelled = await db.scoped(user).invoice.findMany({
    where: { type: "CREDIT_NOTE", cancelsInvoiceId: { not: null } },
    select: { cancelsInvoiceId: true },
  });
  const cancelledIds = cancelled.map((c) => c.cancelsInvoiceId!).filter(Boolean);
  const rows = await db.scoped(user).invoice.findMany({
    where: {
      type: "TAX_INVOICE",
      totalPaise: { not: 0 },
      ...(cancelledIds.length ? { id: { notIn: cancelledIds } } : {}),
      ...(input.propertyId ? { propertyId: input.propertyId } : {}),
      ...(input.gstOnly ? { customerGstin: { not: null } } : {}),
      ...dateFilter,
      ...(kw
        ? {
            OR: [
              { number: { contains: kw, mode: "insensitive" } },
              { customerName: { contains: kw, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: { id: true, number: true, customerName: true, customerGstin: true, totalPaise: true, issuedAt: true, propertyId: true, folio: { select: { reservationId: true } } },
    orderBy: [{ issuedAt: "desc" }, { id: "asc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  // Property names in one lookup (Invoice has no property relation).
  const propIds = [...new Set(page.map((r) => r.propertyId))];
  const props = propIds.length
    ? await db.scoped(user).property.findMany({ where: { id: { in: propIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(props.map((p) => [p.id, p.name]));

  return {
    invoices: page.map((r) => ({
      id: r.id,
      number: r.number,
      customerName: r.customerName,
      customerGstin: r.customerGstin,
      propertyName: nameById.get(r.propertyId) ?? "—",
      totalPaise: Number(r.totalPaise),
      issuedAt: r.issuedAt,
      reservationId: r.folio.reservationId,
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/** Derived balance for a reservation's folio — the 03 checkout gate (FR-18, AC-22). */
export async function getBalance(user: SessionClaims, reservationId: string): Promise<number | null> {
  const folio = await db.scoped(user).folio.findFirst({
    where: { reservationId },
    select: {
      lines: { select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } },
      payments: { select: { amountPaise: true, isRefund: true } },
    },
  });
  if (!folio) return null;
  return Number(folioBalance(folio.lines, folio.payments));
}

export type BillingFolioRow = {
  folioId: string;
  reservationId: string | null;
  code: string;
  guestName: string;
  status: string;
  chargesPaise: number;
  paidPaise: number;
  balancePaise: number;
};

/**
 * Open / recent folios for the Billing home. This is the fix for "a checked-in +
 * paid booking doesn't appear in Billing": that stay creates a Folio + Payment
 * but no Invoice yet, and the invoice register lists only Invoices. Listing the
 * FOLIOS themselves (guest, charges, paid, derived balance) makes every stay with
 * money on it visible immediately — open accounts (balance due) ranked first.
 * `folio:view`, property-scoped. Balance uses the canonical `folioBalance`.
 */
export async function listBillingFolios(
  user: SessionClaims,
  input: { propertyId: string; limit?: number },
): Promise<BillingFolioRow[]> {
  authorize(user, "folio:view", input.propertyId);
  const limit = input.limit ?? 50;
  const folios = await db.scoped(user).folio.findMany({
    where: { propertyId: input.propertyId },
    select: {
      id: true,
      reservationId: true,
      kind: true,
      reservation: { select: { code: true, status: true, guest: { select: { fullName: true } } } },
      lines: { select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } },
      payments: { select: { amountPaise: true, isRefund: true } },
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit * 2, // over-fetch; drop empty folios and re-rank open-first below
  });

  const rows = folios
    .filter((f) => f.lines.length > 0 || f.payments.length > 0)
    .map((f) => {
      let charges = 0n;
      for (const l of f.lines) charges += BigInt(l.amountPaise) + BigInt(l.cgstPaise) + BigInt(l.sgstPaise) + BigInt(l.igstPaise);
      let paid = 0n;
      for (const p of f.payments) paid += p.isRefund ? -BigInt(p.amountPaise) : BigInt(p.amountPaise);
      return {
        folioId: f.id,
        reservationId: f.reservationId,
        code: f.reservation?.code ?? "Walk-in / POS",
        guestName: f.reservation?.guest?.fullName ?? "Direct sale",
        status: f.reservation?.status ?? f.kind,
        chargesPaise: Number(charges),
        paidPaise: Number(paid),
        balancePaise: Number(folioBalance(f.lines, f.payments)),
      };
    });

  // Stable partition: open accounts (balance due) first, then most-recent order.
  rows.sort((a, b) => (b.balancePaise > 0 ? 1 : 0) - (a.balancePaise > 0 ? 1 : 0));
  return rows.slice(0, limit);
}

/**
 * Net taxable revenue EARNED in a business-date window, across properties —
 * tax-excluded, net of discounts and of reversals (FR-24).
 *
 * "Earned in the window" is the point: a reversal is posted on the day the
 * correction is MADE, so summing signed amounts by business date charges a
 * correction against whichever day it was keyed to. Reverse last month's night
 * today and "revenue today" drops by a night that was never today's. Resolving
 * reversals against the lines they cancel keeps each day reporting what that day
 * actually earned, the same basis as the DailyStatSnapshot.
 */
export async function netRevenueBetween(
  user: SessionClaims,
  input: { propertyIds: string[]; from: Date; to: Date },
): Promise<number> {
  if (input.propertyIds.length === 0) return 0;
  const scoped = db.scoped(user);
  const lineSelect = { id: true, type: true, amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, businessDate: true, revision: true, reversalOfId: true } as const;
  const windowLines = await scoped.folioLine.findMany({
    where: { folio: { propertyId: { in: input.propertyIds } }, businessDate: { gte: input.from, lt: input.to } },
    select: lineSelect,
  });
  if (windowLines.length === 0) return 0;
  const reversals = await scoped.folioLine.findMany({
    where: { folio: { propertyId: { in: input.propertyIds } }, reversalOfId: { in: windowLines.map((l) => l.id) } },
    select: lineSelect,
  });
  const inWindow = new Set(windowLines.map((l) => l.id));
  let sum = 0;
  for (const l of activeLines([...windowLines, ...reversals])) {
    if (!inWindow.has(l.id) || l.type === "TAX") continue;
    sum += Number(l.amountPaise);
  }
  return sum;
}

/**
 * Revenue by charge category — net of discount AND of reversals, TAX-EXCLUDED
 * (FR-24, AC-24).
 *
 * A `groupBy type` over the window reported each category GROSS and dumped the
 * corrections into a separate negative REVERSAL bucket, so "room revenue" was
 * overstated by every reversed night. Worse, a reversal posts on the day the
 * correction is made: when that fell outside the window (a September stay
 * corrected in October) the month under review kept the full original revenue
 * and the next month carried an unexplained negative. Resolving reversals
 * against the lines they cancel puts each correction in the right category and,
 * through the window test below, the right period.
 */
export async function revenueByCategory(
  user: SessionClaims,
  input: { propertyId: string; from: Date; to: Date },
): Promise<Record<string, number>> {
  const scoped = db.scoped(user);
  const lineSelect = { id: true, type: true, amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, businessDate: true, revision: true, reversalOfId: true } as const;
  const windowLines = await scoped.folioLine.findMany({
    where: { folio: { propertyId: input.propertyId }, businessDate: { gte: input.from, lte: input.to } },
    select: lineSelect,
  });
  if (windowLines.length === 0) return {};

  // Pull the reversals of this window's lines by TARGET — they may well sit on a
  // later date, outside the window.
  const reversals = await scoped.folioLine.findMany({
    where: { folio: { propertyId: input.propertyId }, reversalOfId: { in: windowLines.map((l) => l.id) } },
    select: lineSelect,
  });

  const inWindow = new Set(windowLines.map((l) => l.id));
  const out: Record<string, number> = {};
  for (const l of activeLines([...windowLines, ...reversals])) {
    // Keep only the window's own survivors; the reversals were loaded purely to
    // decide which of those lines still count.
    if (!inWindow.has(l.id)) continue;
    out[l.type] = (out[l.type] ?? 0) + Number(l.amountPaise);
  }
  return out;
}

/**
 * Billing home summary — outstanding dues + how many folios carry them, cash
 * collected today, and GST invoices issued this month. `folio:view`, property-scoped.
 *
 * Outstanding is computed from grouped aggregates (one row per folio) rather than
 * loading every folio's lines/payments — and because `folioBalance` is a linear
 * sum (Σ charges − Σ signed payments), the grouped form is IDENTICAL to it, not a
 * divergent re-derivation. `billingOverview.outstandingPaise === outstanding()`.
 */
export type BillingOverview = {
  outstandingPaise: number;
  unsettledFolios: number;
  collectedTodayPaise: number;
  invoicesThisMonth: number;
};

export async function billingOverview(user: SessionClaims, propertyId: string): Promise<BillingOverview> {
  authorize(user, "folio:view", propertyId);
  const scoped = db.scoped(user);
  // "Collected today" / "this month" by the India-time day — the UTC day showed
  // yesterday's collections from 00:00 to 05:30.
  const today = localToday();
  const { start: dayStart, next: dayEnd } = localDayInstants(today);
  const monthStart = localDayInstants(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))).start;

  const [lineGroups, payGroups, todayColl, invoicesThisMonth] = await Promise.all([
    scoped.folioLine.groupBy({
      by: ["folioId"],
      where: { folio: { propertyId } },
      _sum: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true },
    }),
    scoped.payment.groupBy({ by: ["folioId", "isRefund"], where: { propertyId }, _sum: { amountPaise: true } }),
    scoped.payment.aggregate({
      where: { propertyId, isRefund: false, receivedAt: { gte: dayStart, lt: dayEnd } },
      _sum: { amountPaise: true },
    }),
    // Count only REAL tax invoices (exclude credit notes + empty ₹0 ones) so the
    // portal figure isn't inflated by voided/fake bills.
    scoped.invoice.count({ where: { propertyId, type: "TAX_INVOICE", totalPaise: { not: 0 }, issuedAt: { gte: monthStart } } }),
  ]);

  const charges = new Map<string, bigint>();
  for (const g of lineGroups) {
    charges.set(
      g.folioId,
      BigInt(g._sum.amountPaise ?? 0n) + BigInt(g._sum.cgstPaise ?? 0) + BigInt(g._sum.sgstPaise ?? 0) + BigInt(g._sum.igstPaise ?? 0),
    );
  }
  const paid = new Map<string, bigint>();
  for (const g of payGroups) {
    const amt = BigInt(g._sum.amountPaise ?? 0n);
    paid.set(g.folioId, (paid.get(g.folioId) ?? 0n) + (g.isRefund ? -amt : amt));
  }

  let outstandingPaise = 0n;
  let unsettledFolios = 0;
  for (const id of new Set([...charges.keys(), ...paid.keys()])) {
    const bal = (charges.get(id) ?? 0n) - (paid.get(id) ?? 0n);
    if (bal > 0n) {
      outstandingPaise += bal;
      unsettledFolios += 1;
    }
  }

  return {
    outstandingPaise: Number(outstandingPaise),
    unsettledFolios,
    collectedTodayPaise: Number(todayColl._sum.amountPaise ?? 0n),
    invoicesThisMonth,
  };
}

/** Total outstanding (Σ folio balances due) for a property (FR-24). */
export async function outstanding(user: SessionClaims, propertyId: string): Promise<number> {
  const folios = await db.scoped(user).folio.findMany({
    where: { propertyId },
    select: {
      lines: { select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } },
      payments: { select: { amountPaise: true, isRefund: true } },
    },
  });
  let total = 0n;
  for (const f of folios) {
    const bal = folioBalance(f.lines, f.payments);
    if (bal > 0n) total += bal;
  }
  return Number(total);
}

/** The corporate receivable this module records — the ONLY read path for 25 (FR-26). */
export async function corporateReceivable(user: SessionClaims, corporateId: string): Promise<number> {
  const corp = await db.unscoped().corporate.findFirst({
    where: { id: corporateId, orgId: user.orgId },
    select: { receivablePaise: true },
  });
  return Number(corp?.receivablePaise ?? 0n);
}

/** Guest-scoped billing roll-up for 05-guest-history (FR-26) — one call, reconciles with 14. */
export async function guestBilling(
  user: SessionClaims,
  guestId: string,
): Promise<{ revenuePaise: number; outstandingPaise: number; invoiceCount: number }> {
  const folios = await db.unscoped().folio.findMany({
    where: { reservation: { guestId, property: { orgId: user.orgId } } },
    select: {
      reservation: { select: { id: true, transferredFromId: true } },
      lines: { select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, type: true } },
      payments: { select: { amountPaise: true, isRefund: true } },
      invoices: { select: { id: true } },
    },
  });
  let revenue = 0n;
  let invoiceCount = 0;
  const legs: JourneyFolio[] = [];
  for (const f of folios) {
    for (const l of f.lines) if (l.type !== "TAX") revenue += BigInt(l.amountPaise); // tax-excluded, net-of-discount
    invoiceCount += f.invoices.length;
    if (f.reservation) {
      legs.push({
        reservationId: f.reservation.id,
        transferredFromId: f.reservation.transferredFromId,
        balancePaise: folioBalance(f.lines, f.payments),
      });
    }
  }
  // Σ of POSITIVE balances, but netted within each linked journey first — a stay
  // split across properties is billed per folio and settled as one statement, so
  // the leg holding the payment must offset the leg holding the charge. Summing
  // every folio's positive balance reported guests as owing money they had
  // already paid. Unrelated stays are still kept apart, so one stay's credit
  // never masks another's due.
  const out = outstandingAcrossJourneys(legs);
  return { revenuePaise: Number(revenue), outstandingPaise: Number(out), invoiceCount };
}
