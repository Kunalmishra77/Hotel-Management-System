/**
 * Stable fixture identifiers for the demo/test dataset.
 *
 * docs/workflows/seed-data.md: "Fixed cuids/known references so specs'
 * `Test Fixtures` tables (in each `user-stories.md`) resolve to real seeded
 * rows." Ids are readable rather than random so a failing test names the row
 * it means. The `Ref` column of each spec's fixture table maps here.
 */

/** specs/00-platform/user-stories.md § Test Fixtures */
export const ORG_ID = "org_woodpecker";

/** PROP-A — "Woodpecker MG Road", code WMG (Karnataka, GST-registered). */
export const PROP_A_ID = "prop_wmg";
/** PROP-B — "Woodpecker Whitefield", code WWF. */
export const PROP_B_ID = "prop_wwf";

export const USER_ADMIN_ID = "user_admin"; // U-ADMIN  — org-wide
export const USER_MANAGER_ID = "user_manager"; // Manager@WMG
export const USER_RECEPTION_A_ID = "user_reception_a"; // U-REC-A  — RECEPTION @ PROP-A, 2FA off
export const USER_ACCOUNTS_ID = "user_accounts"; // U-ACC    — ACCOUNTS @ PROP-A+B, 2FA on
export const USER_HOUSEKEEPING_ID = "user_housekeeping"; // Housekeeping@WMG
export const USER_MAINTENANCE_ID = "user_maintenance"; // Maintenance@WMG
export const USER_OWNER_A_ID = "user_owner_a"; // OWNER @ PROP-A (27 owner-portal)
export const USER_OWNER_AB_ID = "user_owner_ab"; // OWNER @ PROP-A + PROP-B

/**
 * Dev-only credentials. seed-data.md: "Known passwords (dev only)" and
 * "Dev passwords are obviously-fake". These must never appear in a non-dev
 * environment — `seed/index.ts` refuses to run against production.
 */
export const DEV_PASSWORD = "woodpecker-dev-2026";

/**
 * Fixed TOTP secret for U-ACC so 2FA tests are deterministic (AC-2/AC-3).
 * Valid base32. Obviously a fixture, not a real enrolment.
 */
export const USER_ACCOUNTS_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

/**
 * Fixed backup codes for U-ACC (AC-3 exercises consume-then-reuse).
 * Stored hashed; these plaintexts exist only so tests can present one.
 */
export const USER_ACCOUNTS_BACKUP_CODES = [
  "AAAA1111BB",
  "CCCC2222DD",
  "EEEE3333FF",
  "GGGG4444HH",
  "JJJJ5555KK",
] as const;

/** CLOCK — the fixed instant specs use for TOTP/lockout/token tests. */
export const SEED_CLOCK = new Date("2026-07-21T00:00:00.000Z");

// ---------------------------------------------------------------------------
// 01 · Property Management fixtures
// specs/01-property-management/user-stories.md § Test Fixtures
// ---------------------------------------------------------------------------

export const FLOOR_A_GROUND_ID = "floor_wmg_ground";
export const FLOOR_A_1_ID = "floor_wmg_1";
export const FLOOR_A_2_ID = "floor_wmg_2";

/** Categories are owned by 02; 01 needs them for the Room foreign key. */
export const ROOM_CATEGORY_A_DELUXE_ID = "cat_wmg_deluxe";
export const ROOM_CATEGORY_A_SUITE_ID = "cat_wmg_suite";

/** ROOMS-A ids are `room_wmg_<number>` so a failing test names the room. */
export const ROOMS_A_PREFIX = "room_wmg_";

/**
 * ROOMS-A composition asserted by AC-6: 10 rooms — 6 VACANT, 3 OCCUPIED,
 * 1 UNDER_MAINTENANCE ⇒ live current-status occupancy 3 ÷ (10 − 1) = 33%.
 */
export const ROOMS_A_TOTAL = 10;
export const ROOMS_A_VACANT = 6;
export const ROOMS_A_OCCUPIED = 3;
export const ROOMS_A_MAINTENANCE = 1;
export const ROOMS_A_OCCUPANCY_BPS = 3333;

// ---------------------------------------------------------------------------
// 02 · Room Inventory fixtures
// specs/02-room-inventory/user-stories.md § Test Fixtures
//
// CAT-DLX / CAT-STE and R-101/R-102/R-201 are already created by the 01 seed,
// which needed them for its occupancy rollup. 02 reuses those ids rather than
// creating a parallel set — one fixture, one owner.
// ---------------------------------------------------------------------------

/** CAT-DLX — "Deluxe", ₹4,000, max 2 adults / 1 child, HSN 996311. */
export const CAT_DLX_ID = ROOM_CATEGORY_A_DELUXE_ID;
/** CAT-STE — "Suite", ₹7,000, max 3 adults / 2 children. */
export const CAT_STE_ID = ROOM_CATEGORY_A_SUITE_ID;

/** R-101 — Deluxe, floor 1, VACANT. */
export const ROOM_101_ID = `${ROOMS_A_PREFIX}101`;
/** R-102 — Deluxe, floor 1. Seeded VACANT; 02 tests drive it to OCCUPIED. */
export const ROOM_102_ID = `${ROOMS_A_PREFIX}102`;
/** R-201 — Suite, floor 2, VACANT. Used for the RoomBlock cases (AC-8/AC-9). */
export const ROOM_201_ID = `${ROOMS_A_PREFIX}201`;
/** R-202 — seeded UNDER_MAINTENANCE (the 1 maint in ROOMS-A). */
export const ROOM_202_ID = `${ROOMS_A_PREFIX}202`;
/** R-103 — Deluxe, floor 1. Used for the RoomBlock exclusion cases (03 AC-7). */
export const ROOM_103_ID = `${ROOMS_A_PREFIX}103`;
/** R-104 — Deluxe, floor 1. The block-not-status exclusion case (03 AC-7). */
export const ROOM_104_ID = `${ROOMS_A_PREFIX}104`;

// ---------------------------------------------------------------------------
// 03 · Reservations fixtures — specs/03-reservations/user-stories.md
// ---------------------------------------------------------------------------

/** ACME — corporate account, GSTIN, credit limit ₹200,000 (03 AC-21). */
export const CORPORATE_ACME_ID = "corp_acme";

// ---------------------------------------------------------------------------
// 04 · Guest CRM fixtures
// specs/04-guest-crm/user-stories.md § Test Fixtures
// ---------------------------------------------------------------------------

export const GUEST_RAVI_ID = "guest_ravi";
/** Same mobile as G-RAVI — the intentional duplicate for AC-3/AC-11. */
export const GUEST_RAVI2_ID = "guest_ravi2";
export const GUEST_MEHTA_ID = "guest_mehta";

/** Shared mobile that makes RAVI and RAVI2 duplicates. */
export const GUEST_RAVI_MOBILE = "9800000001";
export const GUEST_RAVI_EMAIL = "ravi@ex.com";
