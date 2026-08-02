/**
 * 15 — federation shards. Each adapts an OWNING module's indexed query layer
 * into a `Shard` (normalized, scored, masked SearchResults + its own next token)
 * for `mergeFederated`. 15 never reaches into another module's tables — only its
 * public `queries.ts`. Scoring: an exact key hit (booking code, invoice number,
 * an exact-token guest match) outranks a trigram/text hit.
 */
import { searchGuests } from "@/features/guests/queries";
import { searchReservations } from "@/features/reservations/queries";
import { searchInvoices } from "@/features/billing/queries";
import { searchExpenses } from "@/features/expenses/queries";
import { searchStaff } from "@/features/staff/queries";
import type { Shard } from "./domain/federate";
import type { EntityKind, SearchResult, UnifiedSearchQuery } from "./types";

const EPOCH = new Date(0); // guests/staff lists carry no date; rank falls back to score+id.

/** Does the keyword look like an exact token (phone/email/GSTIN)? Then guest hits are precise. */
function looksExact(kw: string): boolean {
  const t = kw.trim();
  if (t.includes("@")) return true;
  if (/^[0-3]\d[A-Z]{5}\d{4}[A-Z]/i.test(t.replace(/\s/g, ""))) return true; // GSTIN-ish
  return /^\+?[\d\s-]{7,}$/.test(t); // phone-ish
}

type Ctx = { user: import("@/lib/auth/claims").SessionClaims; query: UnifiedSearchQuery; token?: string | null; limit: number };

async function guestShard({ user, query, token, limit }: Ctx): Promise<Shard> {
  const kw = query.keyword ?? "";
  const { guests, nextCursor } = await searchGuests(user, { query: kw, limit, cursor: token ?? undefined });
  const score = kw && looksExact(kw) ? 0.95 : 0.6;
  const rows: SearchResult[] = guests.map((g) => ({
    entity: "guest",
    id: g.id,
    title: g.fullName,
    subtitle: [g.maskedMobile, g.city].filter(Boolean).join(" · ") || undefined,
    score,
    sortAt: EPOCH,
    fields: { name: g.fullName, mobile: g.maskedMobile, email: g.maskedEmail, city: g.city, company: g.companyName },
  }));
  return { entity: "guest", rows, moduleNextCursor: nextCursor, incomingCursor: token };
}

async function reservationShard({ user, query, token, limit }: Ctx): Promise<Shard> {
  const kw = query.keyword?.trim();
  const { reservations, nextCursor } = await searchReservations(user, {
    keyword: kw,
    source: query.filters?.bookingSource,
    propertyId: query.filters?.propertyId,
    dateRange: query.filters?.dateRange
      ? { from: query.filters.dateRange.from, to: query.filters.dateRange.to }
      : undefined,
    cursor: token ?? undefined,
    limit,
  });
  const rows: SearchResult[] = reservations.map((r) => ({
    entity: "reservation",
    id: r.id,
    title: r.code,
    subtitle: `${r.guestName} · ${r.status}`,
    score: kw && r.code.toLowerCase() === kw.toLowerCase() ? 1 : 0.6,
    sortAt: r.checkInDate,
    fields: { code: r.code, guest: r.guestName, status: r.status, checkIn: r.checkInDate.toISOString().slice(0, 10), nights: r.nights, rooms: r.roomNumbers.join(",") },
  }));
  return { entity: "reservation", rows, moduleNextCursor: nextCursor, incomingCursor: token };
}

async function invoiceShard({ user, query, token, limit }: Ctx): Promise<Shard> {
  const kw = query.keyword?.trim();
  const { invoices, nextCursor } = await searchInvoices(user, {
    keyword: kw,
    propertyId: query.filters?.propertyId,
    cursor: token ?? undefined,
    limit,
  });
  const rows: SearchResult[] = invoices.map((inv) => ({
    entity: "invoice",
    id: inv.id,
    title: inv.number,
    subtitle: `${inv.customerName} · ₹${(inv.totalPaise / 100).toLocaleString("en-IN")}`,
    score: kw && inv.number.toLowerCase() === kw.toLowerCase() ? 1 : 0.6,
    sortAt: inv.issuedAt,
    fields: { number: inv.number, customer: inv.customerName, total: inv.totalPaise, issuedAt: inv.issuedAt.toISOString().slice(0, 10) },
  }));
  return { entity: "invoice", rows, moduleNextCursor: nextCursor, incomingCursor: token };
}

async function expenseShard({ user, query, token, limit }: Ctx): Promise<Shard> {
  const { expenses, nextCursor } = await searchExpenses(user, {
    keyword: query.keyword?.trim(),
    propertyId: query.filters?.propertyId,
    cursor: token ?? undefined,
    limit,
  });
  const rows: SearchResult[] = expenses.map((e) => ({
    entity: "expense",
    id: e.id,
    title: `${e.head}${e.vendor ? ` · ${e.vendor}` : ""}`,
    subtitle: `₹${(e.amountPaise / 100).toLocaleString("en-IN")} · ${e.status}`,
    score: 0.5,
    sortAt: e.spentOn,
    fields: { head: e.head, vendor: e.vendor, amount: e.amountPaise, status: e.status, spentOn: e.spentOn.toISOString().slice(0, 10) },
  }));
  return { entity: "expense", rows, moduleNextCursor: nextCursor, incomingCursor: token };
}

async function staffShard({ user, query, token, limit }: Ctx): Promise<Shard> {
  const { staff, nextCursor } = await searchStaff(user, {
    keyword: query.keyword?.trim(),
    propertyId: query.filters?.propertyId,
    cursor: token ?? undefined,
    limit,
  });
  const rows: SearchResult[] = staff.map((s) => ({
    entity: "staff",
    id: s.id,
    title: s.name,
    subtitle: `${s.department}${s.isActive ? "" : " · inactive"}`,
    score: 0.5,
    sortAt: EPOCH,
    fields: { name: s.name, department: s.department, mobile: s.maskedMobile, active: s.isActive ? "yes" : "no" },
  }));
  return { entity: "staff", rows, moduleNextCursor: nextCursor, incomingCursor: token };
}

export const SHARDS: Record<EntityKind, (ctx: Ctx) => Promise<Shard>> = {
  guest: guestShard,
  reservation: reservationShard,
  invoice: invoiceShard,
  expense: expenseShard,
  staff: staffShard,
};
