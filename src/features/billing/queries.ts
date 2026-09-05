/**
 * Billing queries — 06 T-23/T-25 (FR-18/24/26, AC-22/24). All figures derive from
 * folio lines/payments the SAME way (net-of-discount, tax-excluded for revenue),
 * so 08/14/05/25 reconcile to the paisa. Callers pass claims explicitly.
 */
import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { folioBalance } from "./domain/balance";
import type { SessionClaims } from "@/lib/auth/claims";

export type FolioView = {
  id: string;
  balancePaise: number;
  lines: { id: string; type: string; description: string; amountPaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number }[];
  payments: { id: string; mode: string; amountPaise: number; isRefund: boolean }[];
};

export async function getFolio(user: SessionClaims, folioId: string): Promise<FolioView | null> {
  const folio = await db.scoped(user).folio.findFirst({
    where: { id: folioId },
    select: {
      id: true,
      lines: { select: { id: true, type: true, description: true, amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true }, orderBy: { createdAt: "asc" } },
      payments: { select: { id: true, mode: true, amountPaise: true, isRefund: true }, orderBy: { receivedAt: "asc" } },
    },
  });
  if (!folio) return null;
  const balance = folioBalance(folio.lines, folio.payments);
  return {
    id: folio.id,
    balancePaise: Number(balance),
    lines: folio.lines.map((l) => ({ ...l, amountPaise: Number(l.amountPaise) })),
    payments: folio.payments.map((p) => ({ ...p, amountPaise: Number(p.amountPaise) })),
  };
}

export type InvoiceListItem = {
  id: string;
  number: string;
  customerName: string;
  totalPaise: number;
  issuedAt: Date;
};

/**
 * Invoice search — the 15-search federation shard for invoices (15 FR-1/2).
 * Keyword matches the invoice `number` OR the customer name; property-scoped,
 * cursor-paginated, uses the `[propertyId, issuedAt]`/`[propertyId, number]`
 * indexes. Customer name is not PII beyond what the folio already shows.
 */
export async function searchInvoices(
  user: SessionClaims,
  input: { keyword?: string; propertyId?: string; cursor?: string; limit?: number },
): Promise<{ invoices: InvoiceListItem[]; nextCursor: string | null }> {
  const limit = input.limit ?? 25;
  const kw = input.keyword?.trim();
  const rows = await db.scoped(user).invoice.findMany({
    where: {
      ...(input.propertyId ? { propertyId: input.propertyId } : {}),
      ...(kw
        ? {
            OR: [
              { number: { contains: kw, mode: "insensitive" } },
              { customerName: { contains: kw, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: { id: true, number: true, customerName: true, totalPaise: true, issuedAt: true },
    orderBy: [{ issuedAt: "desc" }, { id: "asc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    invoices: page.map((r) => ({
      id: r.id,
      number: r.number,
      customerName: r.customerName,
      totalPaise: Number(r.totalPaise),
      issuedAt: r.issuedAt,
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

/** Revenue by charge category — net of discount, TAX-EXCLUDED (FR-24, AC-24). */
export async function revenueByCategory(
  user: SessionClaims,
  input: { propertyId: string; from: Date; to: Date },
): Promise<Record<string, number>> {
  const grouped = await db.scoped(user).folioLine.groupBy({
    by: ["type"],
    where: { folio: { propertyId: input.propertyId }, businessDate: { gte: input.from, lte: input.to } },
    _sum: { amountPaise: true },
  });
  const out: Record<string, number> = {};
  for (const g of grouped) out[g.type] = Number(g._sum.amountPaise ?? 0n);
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
  const now = Date.now();
  const dayIdx = Math.floor(now / 86_400_000);
  const dayStart = new Date(dayIdx * 86_400_000);
  const dayEnd = new Date((dayIdx + 1) * 86_400_000);
  const nowDate = new Date(now);
  const monthStart = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 1));

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
    scoped.invoice.count({ where: { propertyId, issuedAt: { gte: monthStart } } }),
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
      lines: { select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, type: true } },
      payments: { select: { amountPaise: true, isRefund: true } },
      invoices: { select: { id: true } },
    },
  });
  let revenue = 0n;
  let out = 0n;
  let invoiceCount = 0;
  for (const f of folios) {
    for (const l of f.lines) if (l.type !== "TAX") revenue += BigInt(l.amountPaise); // tax-excluded, net-of-discount
    const bal = folioBalance(f.lines, f.payments);
    if (bal > 0n) out += bal;
    invoiceCount += f.invoices.length;
  }
  return { revenuePaise: Number(revenue), outstandingPaise: Number(out), invoiceCount };
}
