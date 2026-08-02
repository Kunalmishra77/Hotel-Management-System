# 01 · Property Management — User Stories & Acceptance Criteria

Roles per `rules/user-roles.md`. ACs reference the shared fixtures.

## Test Fixtures
| Ref | Entity | Value |
|---|---|---|
| ORG | Organization | "Woodpecker Group" |
| PROP-A | Property | "Woodpecker MG Road", code `WMG`, Karnataka, tz `Asia/Kolkata`, GSTIN valid |
| PROP-B | Property | "Woodpecker Whitefield", code `WWF`, Karnataka |
| USER-ADMIN | User | ADMINISTRATOR @ ORG (all properties) |
| USER-MGR-A | User | MANAGER @ PROP-A only |
| ROOMS-A | Rooms | 10 rooms in PROP-A: 6 VACANT, 3 OCCUPIED, 1 UNDER_MAINTENANCE |

## US-1 — Manage properties
*As an Administrator, I want to add and edit properties, so that operations can begin.*
- **AC-1:** Given USER-ADMIN, when creating PROP-A with all required fields, then it is saved and appears in the property list; `PropertyCreated` emitted + audit written.
- **AC-2:** Given PROP-A exists with code `WMG`, when creating another property with code `WMG` in ORG, then rejected with "code already in use" (FR-2).
- **AC-3:** Given GSTIN `29ABCDE1234F1ZW` (valid — check digit `W` verified), it is accepted; given `29ABC` (malformed) or `29ABCDE1234F1Z5` (correct shape, **wrong check digit**), it is rejected with a field error (FR-3).
  > Corrected 2026-07-21 during implementation: the original example `29ABCDE1234F1Z5` was labelled valid but fails the GSTIN check-digit algorithm. `design.md` requires checksum validation, so the two statements contradicted each other. The number now ends in its real check digit, and the old value is reused as the wrong-checksum negative case.
- **AC-4:** Given PROP-A, when adding floors "Ground", "1", "2", then they persist ordered; a duplicate "1" is rejected (FR-4).

## US-2 — Deactivate without losing history
- **AC-5:** Given PROP-B with past reservations, when USER-ADMIN deactivates it, then it disappears from new-booking property pickers but its historical reports still include it (FR-5).

## US-3 — Live multi-property overview
*As a Manager/Owner, I want a real-time occupancy overview, so that I can see the business at a glance.*
- **AC-6:** Given ROOMS-A, when USER-ADMIN opens the overview, then PROP-A shows total 10, vacant 6, occupied 3, maintenance 1, and **live current-status occupancy** 33% (3 occupied ÷ (10 − 1 maintenance) = 9), labelled as current-status occupancy — not the ADR/RevPAR denominator (`rules/reporting.md`).
- **AC-7:** Given the overview is open, when a vacant room in PROP-A is checked in (status → OCCUPIED), then the tile updates to occupied 4 / live current-status occupancy 44% (4 ÷ (10 − 1)) within 2s without a manual refresh (FR-7).
- **AC-8:** Given USER-MGR-A (scoped to PROP-A), when they open the overview, then only PROP-A is shown, not PROP-B (FR-8).

## Permission / negative
- **AC-9:** Given USER-MGR-A, when they attempt to create a property, then denied server-side (403) — only Administrators create properties (FR-1/8).
- **AC-10:** Given invalid input (missing pincode/state), when saving, then validation rejects with field messages; nothing persists.
