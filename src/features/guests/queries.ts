/**
 * Guest queries — 04 T-16/T-17 (FR-8/10, AC-7/AC-10).
 *
 * searchGuests is the module's hot path (p95 < 500ms on 100k+, AC-10). Its
 * design:
 *  - A digit-only query is treated as a mobile: hashed and matched EXACTLY on
 *    the indexed `mobileHash` — no scan, no decrypt.
 *  - A text query goes to the `pg_trgm` GIN index on `fullName`/`companyName`
 *    plus exact `gstNumber` — the index the T-1 migration added.
 *  - An email-shaped query matches `emailHash` exactly.
 * Everything returns MASKED (AC-7): contact is masked, fullName stays visible.
 * Callers pass claims explicitly (layering, as in 01/02).
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { decryptOptional, keyedHash } from "@/lib/crypto/encryption";
import { maskContact } from "./domain/masking";
import { duplicateScore, isProbableDuplicate } from "./domain/dedupe";
import { normalizeEmail, normalizeGstin, normalizePhone } from "./domain/normalize";
import { emailToken, mobileToken } from "./internal";
import { guestIdsBySegment } from "@/features/guest-history/queries";
import type { SessionClaims } from "@/lib/auth/claims";
import type { SearchGuestsInput } from "./schema";

export type DuplicateCandidate = {
  id: string;
  fullName: string;
  maskedMobile: string | null;
  city: string | null;
};

export type GuestListItem = {
  id: string;
  fullName: string;
  maskedMobile: string | null;
  maskedEmail: string | null;
  city: string | null;
  companyName: string | null;
};

export type GuestSearchResult = {
  guests: GuestListItem[];
  /** Cursor for the next page, or null when exhausted (FR-10). */
  nextCursor: string | null;
};

/** The columns every masked guest-list row needs. */
const GUEST_LIST_SELECT = {
  id: true,
  fullName: true,
  mobile: true,
  email: true,
  city: true,
  companyName: true,
} as const;

type GuestListRow = {
  id: string;
  fullName: string;
  mobile: string | null;
  email: string | null;
  city: string | null;
  companyName: string | null;
};

/**
 * Decrypt-then-mask one contact field. Resilient by design: a single row whose
 * ciphertext can't be opened (e.g. legacy data encrypted under a rotated key)
 * degrades to `null` ("—") rather than throwing and taking down the whole list.
 * The raw value still never leaves the server; exact values go through `revealPii`.
 */
function safeMaskContact(value: string | null, kind: "mobile" | "email"): string | null {
  try {
    return maskContact(decryptOptional(value), kind);
  } catch {
    return null;
  }
}

/** Decrypt-then-mask a guest row into the masked list item (AC-7). */
function toGuestListItem(row: GuestListRow): GuestListItem {
  return {
    id: row.id,
    fullName: row.fullName,
    maskedMobile: safeMaskContact(row.mobile, "mobile"),
    maskedEmail: safeMaskContact(row.email, "email"),
    city: row.city,
    companyName: row.companyName,
  };
}

export type GuestSegment = "vip" | "repeat" | "corporate";

/**
 * Guests in a CRM segment (the guests-page filter chips), MASKED. `corporate` is a
 * direct `companyName` filter (04 owns Guest); `vip`/`repeat` ask 05 for the
 * stats-matching ids (via its query surface) then fetch the org's guests for them —
 * so the id set is always re-scoped to the caller's org here.
 */
export async function guestsBySegment(
  user: SessionClaims,
  input: { segment: GuestSegment; limit?: number },
): Promise<GuestListItem[]> {
  const prisma = db.unscoped();
  const limit = input.limit ?? 24;
  const base = { orgId: user.orgId, deletedAt: null };

  if (input.segment === "corporate") {
    const rows = await prisma.guest.findMany({
      where: { ...base, companyName: { not: null } },
      select: GUEST_LIST_SELECT,
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
      take: limit,
    });
    return rows.map(toGuestListItem);
  }

  const ids = await guestIdsBySegment(user, input.segment, limit);
  if (ids.length === 0) return [];
  const rows = await prisma.guest.findMany({ where: { ...base, id: { in: ids } }, select: GUEST_LIST_SELECT });
  const order = new Map(ids.map((id, i) => [id, i] as const));
  return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)).map(toGuestListItem);
}

/**
 * Search guests, scoped to the caller's org, cursor-paginated, masked.
 *
 * Raw-SQL for the text path so the trigram index is actually used — Prisma's
 * `contains` generates `LIKE` which cannot hit a GIN index. The query is still
 * parameterised (no injection) and org-scoped in the WHERE.
 */
export async function searchGuests(
  user: SessionClaims,
  input: SearchGuestsInput,
): Promise<GuestSearchResult> {
  const prisma = db.unscoped(); // guests are org-scoped, filtered explicitly below
  const query = input.query.trim();
  const limit = input.limit;

  const where = buildWhere(user.orgId, query);

  const rows = await prisma.guest.findMany({
    where,
    select: GUEST_LIST_SELECT,
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
    take: limit + 1, // one extra to detect a next page
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  // Decrypt then mask — the raw value never leaves the server. A caller with
  // reveal permission uses `revealPii`, never this list.
  return {
    guests: page.map(toGuestListItem),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/**
 * Interpret the query and build the WHERE. Exact-token paths (mobile/email) are
 * preferred because they hit a btree index and are unambiguous; text falls back
 * to trigram name/company + exact GSTIN.
 */
function buildWhere(orgId: string, query: string): Prisma.GuestWhereInput {
  const base: Prisma.GuestWhereInput = { orgId, deletedAt: null };
  if (query === "") return base;

  // A mostly-digit query is a phone number.
  const asPhone = normalizePhone(query);
  if (asPhone) {
    const hash = mobileToken(asPhone);
    if (hash) return { ...base, mobileHash: hash };
  }

  // An email-shaped query matches the email token exactly.
  if (query.includes("@")) {
    const normalized = normalizeEmail(query);
    if (normalized) {
      const hash = emailToken(normalized);
      if (hash) return { ...base, emailHash: hash };
    }
  }

  // A GSTIN-shaped query matches gstNumber exactly.
  const asGstin = normalizeGstin(query);
  if (asGstin && /^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z]/.test(asGstin)) {
    return { ...base, gstNumber: { equals: asGstin, mode: "insensitive" } };
  }

  // Otherwise a name/company/city text search plus an exact ID-number match
  // (15 FR-1 §4 facets). `contains` is what the trigram index accelerates; the
  // ID branch hashes the token the same way `addGuestId` did and hits the
  // indexed `GuestId.valueHash` — so a passport/DL/voter number is found without
  // decrypting anything. Case-insensitive for how staff actually type.
  const idHash = keyedHash(query.replace(/\s/g, "").toUpperCase());
  return {
    ...base,
    OR: [
      { fullName: { contains: query, mode: "insensitive" } },
      { companyName: { contains: query, mode: "insensitive" } },
      { city: { contains: query, mode: "insensitive" } },
      { ids: { some: { valueHash: idHash } } },
    ],
  };
}

// ---------------------------------------------------------------------------
// CRM overview (guest landing depth) — cheap indexed counts + a recent list so
// the guests page is useful before anyone types a search. Org-scoped (guests are
// an org-level CRM record). Deliberately avoids unindexed segment scans to keep
// the page fast at 100k+ guests (non-functional-requirements.md).
// ---------------------------------------------------------------------------

export type GuestsOverview = {
  total: number;
  newThisMonth: number;
  withCompany: number;
  recent: GuestListItem[];
};

export async function guestsOverview(user: SessionClaims): Promise<GuestsOverview> {
  const prisma = db.unscoped();
  const base = { orgId: user.orgId, deletedAt: null };
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [total, newThisMonth, withCompany, recentRows] = await Promise.all([
    prisma.guest.count({ where: base }),
    prisma.guest.count({ where: { ...base, createdAt: { gte: monthStart } } }),
    prisma.guest.count({ where: { ...base, companyName: { not: null } } }),
    prisma.guest.findMany({
      where: base,
      select: GUEST_LIST_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 8,
    }),
  ]);

  return {
    total,
    newThisMonth,
    withCompany,
    recent: recentRows.map(toGuestListItem),
  };
}

// ---------------------------------------------------------------------------
// Profile (T-17)
// ---------------------------------------------------------------------------

export type GuestProfile = GuestListItem & {
  state: string | null;
  gstNumber: string | null;
  purposeOfVisit: string | null;
  foodPreference: string | null;
  ids: { id: string; type: string; maskedValue: string | null; hasScan: boolean }[];
};

/** One guest, masked by default (T-17). Reveal goes through `revealPii`. */
export async function getGuestProfile(
  user: SessionClaims,
  guestId: string,
): Promise<GuestProfile | null> {
  const prisma = db.unscoped();
  const guest = await prisma.guest.findFirst({
    where: { id: guestId, orgId: user.orgId, deletedAt: null },
    select: {
      id: true,
      fullName: true,
      mobile: true,
      email: true,
      city: true,
      state: true,
      companyName: true,
      gstNumber: true,
      purposeOfVisit: true,
      foodPreference: true,
      ids: {
        select: { id: true, type: true, maskedValue: true, scanObjectKey: true },
      },
    },
  });
  if (!guest) return null;

  return {
    id: guest.id,
    fullName: guest.fullName,
    maskedMobile: maskContact(decryptOptional(guest.mobile), "mobile"),
    maskedEmail: maskContact(decryptOptional(guest.email), "email"),
    city: guest.city,
    state: guest.state,
    companyName: guest.companyName,
    gstNumber: guest.gstNumber,
    purposeOfVisit: guest.purposeOfVisit,
    foodPreference: guest.foodPreference,
    ids: guest.ids.map((id) => ({
      id: id.id,
      type: id.type,
      maskedValue: id.maskedValue,
      hasScan: id.scanObjectKey !== null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Duplicate lookup for the new-guest dedupe sheet (T-20 / FR-5, AC-3)
// ---------------------------------------------------------------------------

/**
 * Probable duplicates for a would-be new guest, MASKED (AC-7).
 *
 * The new-guest form calls this after `createGuest` returns CONFLICT, to render
 * the resolution sheet (open / merge / create-anyway). It is the read-only twin
 * of the private finder inside `createGuest`'s transaction: same tokens, same
 * threshold — so the sheet lists exactly the guests that blocked the create.
 * Contact is masked from the *input*, never by decrypting a stored value.
 */
export async function findGuestDuplicates(
  user: SessionClaims,
  input: { fullName: string; mobile: string; email?: string | null },
): Promise<DuplicateCandidate[]> {
  const prisma = db.unscoped();
  const mobileHash = mobileToken(input.mobile);
  const emailHash = emailToken(input.email);
  if (!mobileHash && !emailHash) return [];

  const rows = await prisma.guest.findMany({
    where: {
      orgId: user.orgId,
      deletedAt: null,
      OR: [
        ...(mobileHash ? [{ mobileHash }] : []),
        ...(emailHash ? [{ emailHash }] : []),
      ],
    },
    select: { id: true, fullName: true, city: true },
    take: 10,
  });

  return rows
    .filter((row) =>
      isProbableDuplicate(
        duplicateScore(
          { fullName: input.fullName, mobile: input.mobile, email: input.email ?? null, idValues: [] },
          { fullName: row.fullName, mobile: input.mobile, email: input.email ?? null, idValues: [] },
        ),
      ),
    )
    .map((row) => ({
      id: row.id,
      fullName: row.fullName,
      maskedMobile: maskContact(normalizePhone(input.mobile), "mobile"),
      city: row.city,
    }));
}
