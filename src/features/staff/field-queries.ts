/**
 * Field-staff location reads — 09 addendum (FR-19). Manager-only (`staff:manage`),
 * property-scoped. Returns each field-staff's last-known ping with a staleness
 * flag + a Google Maps deep link (no API key). Never exposed outside management.
 */
import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import type { SessionClaims } from "@/lib/auth/claims";
import { FIELD_STALE_MS } from "./field-internal";

export type FieldStaffLocation = {
  staffId: string;
  name: string;
  department: string;
  trackingToken: string | null;
  lastPing: { lat: number; lng: number; accuracyM: number | null; capturedAt: Date } | null;
  stale: boolean;
  mapsUrl: string | null;
};

export async function listFieldStaffLocations(
  user: SessionClaims,
  propertyId: string,
  now: number = Date.now(),
): Promise<FieldStaffLocation[]> {
  authorize(user, "staff:manage", propertyId);

  const rows = await db.scoped(user).staff.findMany({
    where: { propertyId, isFieldStaff: true, isActive: true, deletedAt: null },
    select: {
      id: true,
      name: true,
      department: true,
      trackingToken: true,
      fieldPings: {
        orderBy: { capturedAt: "desc" },
        take: 1,
        select: { lat: true, lng: true, accuracyM: true, capturedAt: true },
      },
    },
    orderBy: { name: "asc" },
  });

  return rows.map((s) => {
    const p = s.fieldPings[0] ?? null;
    return {
      staffId: s.id,
      name: s.name,
      department: s.department,
      trackingToken: s.trackingToken,
      lastPing: p,
      stale: p ? now - p.capturedAt.getTime() > FIELD_STALE_MS : true,
      mapsUrl: p ? `https://www.google.com/maps?q=${p.lat},${p.lng}` : null,
    };
  });
}
