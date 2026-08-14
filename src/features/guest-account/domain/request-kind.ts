/**
 * Guest in-room request taxonomy (Phase 4) — pure. Kinds, guest-facing labels, the
 * status lifecycle, and which staff permission owns each kind (for notification
 * routing). No I/O, so it unit-tests trivially.
 */
import type { Permission } from "@/lib/permissions/permission-map";

export const GUEST_REQUEST_KINDS = ["HOUSEKEEPING", "MAINTENANCE", "AMENITY", "OTHER"] as const;
export type GuestRequestKind = (typeof GUEST_REQUEST_KINDS)[number];

export function isGuestRequestKind(v: unknown): v is GuestRequestKind {
  return typeof v === "string" && (GUEST_REQUEST_KINDS as readonly string[]).includes(v);
}

export const KIND_LABEL: Record<GuestRequestKind, string> = {
  HOUSEKEEPING: "Housekeeping",
  MAINTENANCE: "Maintenance / repair",
  AMENITY: "Amenities",
  OTHER: "Other",
};

export const REQUEST_STATUS_LABEL: Record<string, string> = {
  OPEN: "Received",
  ACKNOWLEDGED: "Acknowledged",
  IN_PROGRESS: "In progress",
  DONE: "Completed",
  DECLINED: "Declined",
};

/** Statuses a request is still open under (drives the guest's "active" tracker). */
export const ACTIVE_REQUEST_STATUSES = ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS"] as const;

/** The next staff-advanceable statuses from a given one (forward-only). */
export const NEXT_STATUSES: Record<string, string[]> = {
  OPEN: ["ACKNOWLEDGED", "IN_PROGRESS", "DONE", "DECLINED"],
  ACKNOWLEDGED: ["IN_PROGRESS", "DONE", "DECLINED"],
  IN_PROGRESS: ["DONE", "DECLINED"],
  DONE: [],
  DECLINED: [],
};

/**
 * The department permission that owns a request of this kind — reception
 * (`reservation:view`) is always notified as the front-desk hub, and the specific
 * department for housekeeping/maintenance so they can act.
 */
export function departmentPermissionForKind(kind: GuestRequestKind): Permission | null {
  switch (kind) {
    case "HOUSEKEEPING":
      return "housekeeping:update";
    case "MAINTENANCE":
      return "maintenance:manage";
    default:
      return null; // AMENITY / OTHER → reception only
  }
}
