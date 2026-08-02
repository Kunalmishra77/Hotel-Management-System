/**
 * Room status state machine — 02 T-4/T-5 (FR-5, AC-6/AC-7/AC-14). Pure domain.
 *
 * `canTransition` is the SINGLE authority for the lifecycle (design.md). Every
 * caller goes through it: 03 on reserve/check-in/check-out and the cancel and
 * no-show resets, 10 when a room is cleaned, 11 when it goes out of order.
 *
 *         reserve            check-in           check-out          cleaned
 *  VACANT ────────► RESERVED ────────► OCCUPIED ────────► HOUSEKEEPING ──► VACANT
 *     │  ▲              │                 │  ▲                  │
 *     │  │ cancel       │ cancel/no-show  │  │ walk-in          │
 *     │  └──────────────┴─────────────────┘  └──── VACANT ──────┘
 *     │
 *     └──── block ──► UNDER_MAINTENANCE ──── end-block ──► VACANT
 *
 * Note what this does NOT model: date-ranged out-of-order periods. Those live in
 * `RoomBlock` (FR-7). Status drives the board colour; the block drives
 * availability. Conflating them is the mistake the schema note warns against.
 */
import type { RoleName, RoomStatus } from "@prisma/client";

export const ROOM_STATUSES = [
  "VACANT",
  "OCCUPIED",
  "RESERVED",
  "UNDER_MAINTENANCE",
  "HOUSEKEEPING",
] as const satisfies readonly RoomStatus[];

/**
 * Legal edges, keyed by source status.
 *
 * A status is deliberately NOT listed as its own target: FR-6 emits
 * `RoomStatusChanged` on every change, so permitting a self-transition would
 * announce a change that never happened and wake every consumer for nothing.
 */
const TRANSITIONS: Record<RoomStatus, readonly RoomStatus[]> = {
  VACANT: [
    "RESERVED", // a booking holds it
    "OCCUPIED", // walk-in occupies directly, with no prior reservation
    "UNDER_MAINTENANCE", // taken out of order
  ],
  RESERVED: [
    "OCCUPIED", // guest checks in
    "VACANT", // cancel / no-show release (AC-14, backs 03 AC-12/AC-22)
  ],
  OCCUPIED: [
    "HOUSEKEEPING", // guest checks out, room needs cleaning
    "VACANT", // no-show reset / correction (AC-14)
  ],
  HOUSEKEEPING: [
    "VACANT", // cleaned and inspected
    "UNDER_MAINTENANCE", // damage found while cleaning
  ],
  UNDER_MAINTENANCE: [
    // Released only to VACANT — a room out of order must return to inventory
    // before it can be sold, never straight to a guest (AC-6).
    "VACANT",
  ],
};

export function canTransition(from: RoomStatus, to: RoomStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: RoomStatus): readonly RoomStatus[] {
  return TRANSITIONS[from];
}

/**
 * Which roles may drive a transition INTO a given status (AC-7).
 *
 * Administrator and Manager are implicitly permitted everywhere the state
 * machine allows — they carry `room:manage`.
 */
const ROLES_FOR_TARGET: Record<RoomStatus, readonly RoleName[]> = {
  // Front-desk states. 03 performs these on the reception user's behalf.
  RESERVED: ["ADMINISTRATOR", "MANAGER", "RECEPTION"],
  OCCUPIED: ["ADMINISTRATOR", "MANAGER", "RECEPTION"],
  // Check-out puts a room into cleaning; housekeeping also flags its own work.
  HOUSEKEEPING: ["ADMINISTRATOR", "MANAGER", "RECEPTION", "HOUSEKEEPING"],
  // Housekeeping releases a cleaned room; reception releases on cancel/no-show.
  VACANT: ["ADMINISTRATOR", "MANAGER", "RECEPTION", "HOUSEKEEPING", "MAINTENANCE"],
  // Removing a room from sale is a maintenance decision, not a cleaning one:
  // housekeeping reports a fault (10 → 11) rather than taking inventory offline.
  UNDER_MAINTENANCE: ["ADMINISTRATOR", "MANAGER", "MAINTENANCE"],
};

/**
 * Role-gated transition check.
 *
 * Narrows the state machine; it can never widen it — an illegal edge stays
 * illegal for every role, including Administrator.
 */
export function canTransitionAsRole(
  from: RoomStatus,
  to: RoomStatus,
  roles: readonly RoleName[],
): boolean {
  if (!canTransition(from, to)) return false;
  const permitted = ROLES_FOR_TARGET[to];
  return roles.some((role) => permitted.includes(role));
}

/** The transitions this caller may actually perform — drives the action sheet. */
export function allowedTransitionsForRole(
  from: RoomStatus,
  roles: readonly RoleName[],
): RoomStatus[] {
  return allowedTransitions(from).filter((to) => canTransitionAsRole(from, to, roles));
}

/**
 * Whether a room in this status can be allocated by 03.
 *
 * Only VACANT. `RESERVED` is already spoken for; `OCCUPIED` has someone in it;
 * `HOUSEKEEPING` is not yet sellable; `UNDER_MAINTENANCE` is out of order.
 *
 * This is the STATUS half of availability only — 03 must also exclude rooms
 * with an overlapping `RoomBlock` and an overlapping `RoomAllocation`
 * (database-setup.md: "Availability = allocations + blocks").
 */
export function isBookableStatus(status: RoomStatus): boolean {
  return status === "VACANT";
}
