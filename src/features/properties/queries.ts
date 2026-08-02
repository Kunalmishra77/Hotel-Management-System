/**
 * Property queries — 01 T-10/T-11 (FR-6/FR-8, AC-6/AC-8).
 *
 * Every function takes the caller's claims explicitly rather than resolving a
 * session itself. Two reasons:
 *  1. Layering — architecture.md puts session resolution in the application
 *     layer; a query that reaches for the current session is doing two jobs.
 *  2. It keeps this module free of the Auth.js import chain, so the query layer
 *     is testable directly without booting a request context.
 * Callers (server components / actions) do `const user = await requireUser()`
 * and pass it down.
 *
 * All reads are scoped to the caller's assignments; an Administrator's org-wide
 * scope resolves to every property in the org (00 FR-10).
 */
import { assertPropertyInScope, db } from "@/lib/db";
import type { SessionClaims } from "@/lib/auth/claims";
import { occupancyRollupFromCounts, type OccupancyRollup } from "./domain/occupancy";

/**
 * Unscoped by necessity: `Property` is the root of the tenancy tree, not a row
 * inside it, so the boundary is applied here explicitly against
 * `claims.accessiblePropertyIds` — the exact set `db.scoped()` would filter by.
 */
const prisma = db.unscoped();

export type PropertyListItem = {
  id: string;
  name: string;
  code: string;
  city: string;
  state: string;
  timezone: string;
  gstin: string | null;
  isActive: boolean;
};

export type PropertyOverviewItem = PropertyListItem & {
  occupancy: OccupancyRollup;
};

const PROPERTY_SELECT = {
  id: true,
  name: true,
  code: true,
  city: true,
  state: true,
  timezone: true,
  gstin: true,
  isActive: true,
} as const;

/**
 * Properties the caller may see (FR-8, AC-8).
 *
 * `includeInactive` defaults to false: FR-5 removes a deactivated property from
 * operational flows while keeping it for historical reporting, so the default
 * read is the operational one and reports opt in explicitly.
 */
export async function listProperties(
  user: SessionClaims,
  options: { includeInactive?: boolean } = {},
): Promise<PropertyListItem[]> {
  if (user.accessiblePropertyIds.length === 0) return [];

  return prisma.property.findMany({
    where: {
      id: { in: [...user.accessiblePropertyIds] },
      orgId: user.orgId,
      ...(options.includeInactive ? {} : { isActive: true, deletedAt: null }),
    },
    select: PROPERTY_SELECT,
    orderBy: { code: "asc" },
  });
}

/** One property. Throws OUT_OF_SCOPE before reading anything (00 FR-9). */
export async function getProperty(
  user: SessionClaims,
  id: string,
): Promise<PropertyListItem | null> {
  assertPropertyInScope(user, id);
  return prisma.property.findFirst({
    where: { id, orgId: user.orgId },
    select: PROPERTY_SELECT,
  });
}

export type FloorListItem = { id: string; name: string; sortOrder: number };

export async function listFloors(
  user: SessionClaims,
  propertyId: string,
): Promise<FloorListItem[]> {
  assertPropertyInScope(user, propertyId);
  return prisma.floor.findMany({
    where: { propertyId },
    select: { id: true, name: true, sortOrder: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

/**
 * The multi-property overview with live occupancy (FR-6, AC-6/AC-8).
 *
 * One `groupBy` over `Room(propertyId, status)` — the index T-1 confirmed — so
 * a 1000-room property costs a single grouped count rather than 1000 rows
 * (design.md § Edge cases). Inactive rooms are filtered in SQL for the same
 * reason.
 */
export async function propertyOverview(
  user: SessionClaims,
): Promise<PropertyOverviewItem[]> {
  const properties = await listProperties(user);
  if (properties.length === 0) return [];

  const grouped = await prisma.room.groupBy({
    by: ["propertyId", "status"],
    where: { propertyId: { in: properties.map((p) => p.id) }, isActive: true },
    _count: { _all: true },
  });

  const countsByProperty = new Map<string, Record<string, number>>();
  for (const row of grouped) {
    const bucket = countsByProperty.get(row.propertyId) ?? {};
    bucket[row.status] = row._count._all;
    countsByProperty.set(row.propertyId, bucket);
  }

  return properties.map((property) => ({
    ...property,
    // A property with no rooms yields an empty bucket → 0%, not NaN.
    occupancy: occupancyRollupFromCounts(countsByProperty.get(property.id) ?? {}),
  }));
}
