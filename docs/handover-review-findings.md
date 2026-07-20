# Pre-Handover Review — Findings & Resolution Register

Independent adversarial review by 5 reviewers over all 26 modules + shared docs + schema. **92 findings: 7 blockers, 41 major, 44 minor.** Status: ☑ fixed · ◻ pending. Grouped by systemic theme (fix-once) then per-module.

## Systemic (shared files — each clears many findings)
- ☑ **S1 RBAC matrix incomplete** — added `folio:defer`, `guest:manage`, `guest:merge`, `pos:order-*`, `inventory:manage`, `pricing:approve`, `corporate:manage`, `bookingengine:manage`. (R1,R2,R5)
- ☑ **S2 Event catalog incomplete** — added ~45 missing events (Guest*, Payroll*, PosOrder*, WebBooking*, DynamicRate*, Corporate*, security, comms, channel, AI, accounting, search) with payloads + consumers; fixed split-payment payload; fixed 22 to consume `InvoiceIssued` not `FolioCharged`. (all)
- ☑ **S3 Contracts drift** — renamed `postCharge`→`postFolioCharge`; added `settlePosSaleDirect`, `confirmReservation`, `reverseFolioLine`/credit-note, `getStaffForPayroll`, `getFinalizedStaffCost`, `corporateReceivable`, negotiated-rate + `reserveCredit`, `reallocateRoom`, `recordSentiment`, `postRoomCharges`(14→06), `markNoShows(propertyId,businessDate)`; enriched `writeAudit`/`emitEvent` with request-context. (R1,R2,R3,R4,R5)
- ☑ **S4 Tier inversions** — reclassified Corporate/TravelAgent **entities + credit + negotiated-rate as Tier-1 master-data services** (module 25's CRM reporting stays Tier 7); added 14→06/03 calls to connectivity. (R5,R4)
- ☑ **S5 Profit definition** — `reporting.md` now defines Expenses = 07 approved (excl. STAFF-salary) + finalized payroll cost, counted once; occupancy denominator clarified; daily staff-cost apportionment stated. (R3)
- ☑ **S6 "Schema notes: add X" stale** — all designs re-worded to "confirmed in canonical schema" (fields already exist). (all)
- ☑ **S7 Currency rule** — `data-model.md` amended to single-currency INR (no per-row currency column). (R1)
- ☑ **S8 Schema hardening** — folio-less direct-sale path (nullable `Folio.reservationId`); `RoomCategory.gstBps`; `DomainEvent.seq` autoincrement (ordering); BigInt for folio/invoice/credit money; config fields (day-use, hold TTL, quiet hours, no-show policy, discount threshold); PayrollRun `sequence`; idempotency indexes; AuditLog action/property indexes; explicit onDelete + CHECK notes in database-setup. (R1,R2,R3,R5)

## Blockers (per-module)
- ☑ **B1** 03/02 — availability ignores date-ranged `RoomBlock`; add exclusion + search filter.
- ☑ **B2** 06 — GST place-of-supply = property location for accommodation/on-premise (not bill-to state).
- ☑ **B3** 06/19 — `settlePosSaleDirect` (walk-in) had no home; added.
- ☑ **B4** 08/reporting — profit omitted payroll staff cost (see S5).
- ☑ **B5** 19/20/24/25 — permissions missing from RBAC (see S1).
- ☑ **B6** 25/24 — negotiated-rate resolution tier-impossible (see S4).
- ☑ **B7** 14/06 — night-audit `postRoomCharges` name drift + not in contracts (see S3).

## Per-module (major/minor) — see each module's updated spec; tracked resolved unless noted
00 active-property scoping + Session/SecuritySettings ownership + audit/event context + event ordering · 02 state-machine cancel edges + RoomBlock ownership · 03 confirmReservation/reallocate/config/oversell-ingest · 04 erasure-clears-hashes + dedupe-race + perms · 05 full-event-consumption + GuestMerged + guest-scoped query · 06 refund-sign + discount-GST + short-tx numbering + FY + credit-note-series + night-audit-idempotency + folio-less + BigInt · 07 status-not-isApproved + double-count guard · 08 staff-cost grain + 21 contract · 09 getStaffForPayroll · 10 conflict-timestamp · 11 block-vs-reservation + preventive-leadtime · 12 quiet-hours + recordSentiment + due-dedupe + index/typo · 13 oversell-persistence + rate-event-name · 14 segment-snapshot + FAILED-rerun · 15 multi-entity-query shape · 16 audit-indexes + session-revocation + backup-retention · 17 realtime-negative-AC · 18 chatbot-auth + 24-seam + sentiment-writeback · 19 void-action + numbering + SETTLING + ensureFolio-step · 20 idempotency-index + boundary-fixture · 21 leave→LOP + adjustment-run + advance-carryforward + paidDays-cap · 22 consume-InvoiceIssued · 23 folio-less-refund + room-GST + reallocate · 24 resolveRate-signature + writer · 25 credit-atomic + receivable-writer.

## Resolution approach
Shared files (S1–S8, B2/B4/B5/B6/B7) fixed centrally. Per-module items applied to each spec by 5 fix-agents. Every fix cross-checked against the finalized schema + contracts so the set stays internally consistent.

## Verification (complete)
Post-fix sweep confirms: **all 92 findings resolved**; no stale action names (`postCharge`/`moveRoom`/`checkCredit`/`reverseLine`/`postRoomNightCharges`) remain except deliberate "NOT X" clarifications; no stale "propose adding / architect review" schema notes; 26/26 module bundles complete; schema 66 models / 17 enums structurally valid (no dup/missing-id/orphan-relation); zero broken internal links; `src/` empty (no implementation). Two shared docs (`api-surface.md`, `key-workflows.md`) that predated the contract rename were also aligned. **Status: handover-ready.**
