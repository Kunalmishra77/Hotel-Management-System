-- =============================================================================
-- 04-guest-crm · T-1 — fuzzy guest search index
--
-- FR-10 requires multi-field guest search at p95 < 500ms over 100k+ guests.
-- A `LIKE '%term%'` on fullName cannot use a btree index at all — Postgres
-- falls back to a sequential scan, which is exactly the shape that degrades
-- with volume.
--
-- Prisma cannot express a GIN/trigram index, so this is hand-written. The
-- canonical schema notes it: "migration adds a pg_trgm GIN index on fullName
-- for fast fuzzy search (04/15)". The pg_trgm extension itself was installed by
-- 00's baseline migration.
-- =============================================================================

-- Trigram index for substring and similarity search on the guest's name.
-- gin_trgm_ops supports LIKE '%x%', ILIKE and the `%` similarity operator.
CREATE INDEX IF NOT EXISTS "Guest_fullName_trgm_idx"
  ON "Guest" USING gin ("fullName" gin_trgm_ops);

-- Company name is the other free-text field FR-10 searches; same reasoning.
CREATE INDEX IF NOT EXISTS "Guest_companyName_trgm_idx"
  ON "Guest" USING gin ("companyName" gin_trgm_ops);

-- Exact-match lookups by keyed token (mobileHash/emailHash) already have
-- btree indexes from the baseline migration. Soft-deleted guests are excluded
-- from search, so a partial index keeps the working set small as erased and
-- merged records accumulate.
CREATE INDEX IF NOT EXISTS "Guest_org_active_idx"
  ON "Guest" ("orgId") WHERE "deletedAt" IS NULL;
