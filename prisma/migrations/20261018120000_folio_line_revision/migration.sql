-- =============================================================================
-- 06-billing — per-night room-rate corrections (FolioLine.revision)
--
-- WHY
-- ---
-- `FolioLine_room_night_unique` enforced at most ONE ROOM line per
-- (folio, businessDate) — including REVERSED ones, because a partial index
-- cannot see whether another row reverses this one. That made it impossible to
-- re-post a corrected room-night ON ITS OWN NIGHT, so `correctRoomRate` had to
-- collapse the whole stay into ONE aggregate ROOM line parked on a scavenged
-- free date. Consequences that shipped as bugs:
--
--   * per-night revenue vanished — a 10-night stay booked ₹22,500 against ONE
--     business date, so daily room revenue / ADR / RevPAR / occupancy-revenue
--     (14's DailyStatSnapshot, keyed by businessDate) were badly wrong;
--   * the "which nights are already posted" guard (check-in, night audit,
--     extend, check-out) keys on businessDate, so the nights folded into the
--     aggregate looked UNPOSTED (re-post risk) while the scavenged date looked
--     POSTED — an extend then silently SKIPPED billing that night;
--   * a stay could only ever carry ONE rate: correcting the rate for an
--     extension rewrote the earlier nights too, destroying agreed pricing.
--
-- WHAT
-- ----
-- `revision` makes the correction chain explicit and keeps the night on its own
-- date: the original night is revision 0; each correction reverses the active
-- line and appends the same night at revision+1. The unique index moves to
-- (folioId, businessDate, revision) so:
--
--   * night-audit / check-in idempotency still holds — a re-run inserts
--     revision 0 again and conflicts, exactly as before;
--   * a correction can post the SAME night again (next revision) on its TRUE
--     business date, so per-night revenue and all businessDate-keyed MIS stay
--     correct;
--   * "one ACTIVE ROOM line per night" is the application invariant (a line is
--     active iff no REVERSAL references it) — the shape the data always had,
--     now representable.
--
-- FolioLine stays strictly append-only: `revision` is set at INSERT, never
-- updated. No backfill is needed — every existing row is revision 0, which is
-- what the DEFAULT gives it.
--
-- Reversal (documented; Prisma migrations are forward-only):
--   DROP INDEX "FolioLine_room_night_unique";
--   CREATE UNIQUE INDEX "FolioLine_room_night_unique"
--     ON "FolioLine" ("folioId", "businessDate") WHERE "type" = 'ROOM';
--   ALTER TABLE "FolioLine" DROP COLUMN "revision";
-- =============================================================================

ALTER TABLE "FolioLine"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

DROP INDEX "FolioLine_room_night_unique";

CREATE UNIQUE INDEX "FolioLine_room_night_unique"
  ON "FolioLine" ("folioId", "businessDate", "revision")
  WHERE "type" = 'ROOM';
