/**
 * 15 T-7 — runStructuredQuery (FR-7, AC-6/AC-11).
 *
 * The 18-ai execution path. An LLM compiles NL into a StructuredQuery; this
 * VALIDATES it against the per-entity allow-list FIRST (never executes an invalid
 * one), then builds a PARAMETERISED Prisma `where` from the whitelisted typed
 * filters and runs it with the caller's scope. No raw SQL ever crosses in — the
 * LLM cannot name a column that isn't on the allow-list, and values stay literal.
 * Results are masked exactly like unified search.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { decryptOptional } from "@/lib/crypto/encryption";
import { maskContact } from "@/features/guests/domain/masking";
import { validateStructuredQuery } from "./domain/structured-query";
import type { SearchResult, StructuredFilter, StructuredQuery } from "./types";
import type { SessionClaims } from "@/lib/auth/claims";

const MAX_LIMIT = 200;

/** Translate one validated, whitelisted filter into a Prisma clause. */
function clause(f: StructuredFilter): Record<string, unknown> {
  switch (f.op) {
    case "eq":
      return { [f.field]: { equals: f.value } };
    case "contains":
      return { [f.field]: { contains: String(f.value), mode: "insensitive" } };
    case "gte":
      return { [f.field]: { gte: f.value } };
    case "lte":
      return { [f.field]: { lte: f.value } };
    case "in":
      return { [f.field]: { in: f.value as string[] } };
  }
}

function buildWhere(q: StructuredQuery): Record<string, unknown> {
  const and: Record<string, unknown>[] = q.filters.map(clause);
  if (q.dateRange) and.push({ [q.dateRange.field]: { gte: q.dateRange.from, lte: q.dateRange.to } });
  return and.length ? { AND: and } : {};
}

/** Run a validated structured query, scoped + masked. Throws INVALID_QUERY if invalid (never runs). */
export async function runStructuredQuery(user: SessionClaims, query: StructuredQuery): Promise<SearchResult[]> {
  const validated = validateStructuredQuery(query); // throws INVALID_QUERY on any deviation (AC-11)
  if (!validated.ok) return []; // unreachable (validate throws), but keeps the type honest
  const q = validated.data;
  const limit = Math.min(q.limit ?? 25, MAX_LIMIT);
  const where = buildWhere(q);
  const orderBy = q.sort ? { [q.sort.field]: q.sort.dir } : undefined;

  switch (q.entity) {
    case "guest": {
      // Guests are ORG-scoped (not property); filter orgId explicitly like searchGuests.
      const rows = await db.unscoped().guest.findMany({
        where: { orgId: user.orgId, deletedAt: null, ...(where as Prisma.GuestWhereInput) },
        select: { id: true, fullName: true, mobile: true, email: true, city: true, companyName: true, createdAt: true },
        orderBy: (orderBy as Prisma.GuestOrderByWithRelationInput) ?? { fullName: "asc" },
        take: limit,
      });
      return rows.map((g) => ({
        entity: "guest",
        id: g.id,
        title: g.fullName,
        subtitle: g.city ?? undefined,
        score: 0.8,
        sortAt: g.createdAt,
        fields: { name: g.fullName, mobile: maskContact(decryptOptional(g.mobile), "mobile"), email: maskContact(decryptOptional(g.email), "email"), city: g.city, company: g.companyName },
      }));
    }
    case "reservation": {
      const rows = await db.scoped(user).reservation.findMany({
        where: where as Prisma.ReservationWhereInput,
        select: { id: true, code: true, status: true, checkInDate: true, guest: { select: { fullName: true } } },
        orderBy: (orderBy as Prisma.ReservationOrderByWithRelationInput) ?? { checkInDate: "desc" },
        take: limit,
      });
      return rows.map((r) => ({ entity: "reservation", id: r.id, title: r.code, subtitle: `${r.guest.fullName} · ${r.status}`, score: 0.8, sortAt: r.checkInDate, fields: { code: r.code, guest: r.guest.fullName, status: r.status } }));
    }
    case "invoice": {
      const rows = await db.scoped(user).invoice.findMany({
        where: where as Prisma.InvoiceWhereInput,
        select: { id: true, number: true, customerName: true, totalPaise: true, issuedAt: true },
        orderBy: (orderBy as Prisma.InvoiceOrderByWithRelationInput) ?? { issuedAt: "desc" },
        take: limit,
      });
      return rows.map((i) => ({ entity: "invoice", id: i.id, title: i.number, subtitle: i.customerName, score: 0.8, sortAt: i.issuedAt, fields: { number: i.number, customer: i.customerName, total: Number(i.totalPaise) } }));
    }
    case "expense": {
      const rows = await db.scoped(user).expense.findMany({
        where: where as Prisma.ExpenseWhereInput,
        select: { id: true, head: true, vendor: true, amountPaise: true, status: true, spentOn: true },
        orderBy: (orderBy as Prisma.ExpenseOrderByWithRelationInput) ?? { spentOn: "desc" },
        take: limit,
      });
      return rows.map((e) => ({ entity: "expense", id: e.id, title: e.head, subtitle: e.vendor ?? undefined, score: 0.7, sortAt: e.spentOn, fields: { head: e.head, vendor: e.vendor, amount: e.amountPaise, status: e.status } }));
    }
    case "staff": {
      const rows = await db.scoped(user).staff.findMany({
        where: { deletedAt: null, ...(where as Prisma.StaffWhereInput) },
        select: { id: true, name: true, department: true, isActive: true },
        orderBy: (orderBy as Prisma.StaffOrderByWithRelationInput) ?? { name: "asc" },
        take: limit,
      });
      return rows.map((s) => ({ entity: "staff", id: s.id, title: s.name, subtitle: s.department, score: 0.7, sortAt: new Date(0), fields: { name: s.name, department: s.department, active: s.isActive ? "yes" : "no" } }));
    }
  }
}
