-- =============================================================================
-- 03-reservations · T-1/T-2 — the no-overbooking core
--
-- Two things Prisma's schema language cannot express, added here as raw SQL:
--
--  1. A PostgreSQL EXCLUSION CONSTRAINT on RoomAllocation. This is what makes
--     FR-4 / AC-5 / AC-6 true *by construction*: even a race that slips past the
--     application's availability re-check fails the INSERT and rolls back. There
--     is no window in which two allocations for the same room can overlap.
--
--  2. The `needsAttention` enum + column (FR-14 / AC-27): an OTA push that can't
--     be allocated is ingested unallocated and flagged, never dropped.
--
-- Range semantics: daterange(start, end, '[)') — inclusive start, EXCLUSIVE end.
-- So a stay checking out on the 15th and another checking in on the 15th do NOT
-- overlap (AC-8: the checkout day is bookable). This matches the `[)` overlap
-- semantics the domain `overlaps()` uses, and the RoomBlock half-open ranges 02
-- already uses — one consistent convention across availability.
--
-- Availability = allocations + blocks. This constraint covers RoomAllocation
-- ONLY. Overlapping-RoomBlock rejection (02-owned table) is enforced in the
-- serializable booking transaction (see actions.ts / database-setup.md), because
-- a single exclusion constraint cannot span two tables.
--
-- Reversal (Prisma migrations are forward-only; documented for a manual down):
--   ALTER TABLE "RoomAllocation" DROP CONSTRAINT "room_no_overlap";
--   DROP INDEX "Reservation_needsAttention_idx";
--   ALTER TABLE "Reservation" DROP COLUMN "needsAttention";
--   DROP TYPE "ReservationAttention";
--   -- btree_gist is left installed; it is harmless and may be shared.
-- =============================================================================

-- 1 · needsAttention (FR-14 / AC-27)
CREATE TYPE "ReservationAttention" AS ENUM ('OVERSELL', 'MAPPING_MISSING');

ALTER TABLE "Reservation" ADD COLUMN "needsAttention" "ReservationAttention";

-- Reception's "needs attention" queue is a small slice of a large table — a
-- partial index keeps it tiny and the lookup index-only.
CREATE INDEX "Reservation_needsAttention_idx"
  ON "Reservation" ("propertyId")
  WHERE "needsAttention" IS NOT NULL;

-- 2 · No overbooking, ever (FR-4 / AC-5 / AC-6)
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "RoomAllocation"
  ADD CONSTRAINT "room_no_overlap"
  EXCLUDE USING gist (
    "roomId" WITH =,
    daterange("startDate", "endDate", '[)') WITH &&
  );
