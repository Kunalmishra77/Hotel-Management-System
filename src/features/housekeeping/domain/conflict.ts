/**
 * Offline conflict resolution — 10 T-3/T-4 (FR-5, AC-6). Pure. THE crux of this
 * module: a housekeeping update made offline must not clobber a newer server
 * change (e.g. the room was re-occupied while the phone was offline).
 *
 * Rule (NOT blind last-writer-wins): if the offline write's `clientUpdatedAt`
 * predates the room/task's authoritative `serverStatusChangedAt`, the write is
 * STALE — rejected and surfaced for re-check. Otherwise it may apply, still
 * subject to 02's transition validation as the final guard.
 */
export type Resolution = { apply: true } | { apply: false; reason: "STALE" };

export function resolveConflict(
  local: { clientUpdatedAt: Date },
  server: { serverStatusChangedAt: Date | null },
): Resolution {
  if (server.serverStatusChangedAt && local.clientUpdatedAt < server.serverStatusChangedAt) {
    return { apply: false, reason: "STALE" };
  }
  return { apply: true };
}

export type NewTask = {
  propertyId: string;
  roomId: string;
  type: "CLEANING";
  status: "PENDING";
};

/** The cleaning task derived when a room enters HOUSEKEEPING (FR-2, AC-1). */
export function taskFor(room: { id: string; propertyId: string }): NewTask {
  return { propertyId: room.propertyId, roomId: room.id, type: "CLEANING", status: "PENDING" };
}
