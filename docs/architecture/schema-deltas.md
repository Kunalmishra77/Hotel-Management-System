# Schema Deltas & Open Questions (consolidated)

> **STATUS: APPLIED.** All additive changes below are now folded into the finalized [`prisma/schema.prisma`](../../prisma/schema.prisma). This table is retained as the change history / rationale and as the per-module migration checklist (each module's task T-1 still writes the migration that materializes its slice + the DB-level constraints/indexes noted below). Validate with `npx prisma validate` after `npm install`.

Every module spec originally proposed **additive** schema changes in its `design.md` "Schema notes" rather than editing the canonical model directly (to keep it conflict-free during parallel spec authoring). Those are now integrated. None were breaking.

**Pass-3 additions (manual folder audit, 2026-07-20) — schema now 68 models / 24 enums, `prisma validate` PASS:**
- **§11 discount coupons (feature):** `Coupon` + `CouponRedemption` (owned by 06) + enums `CouponDiscountType`/`CouponStatus`; `Campaign.couponId` (marketing distributes a code). Redeemed atomically at 23/06.
- **§11 per-property comms content:** `Property.wifiSsid/wifiPassword/houseRules/emergencyContact/locationMapUrl/checkInInstructions` (merge values for during-stay/before-arrival templates).
- **§2 planned arrival:** `Reservation.expectedArrival`.
- **Consistency:** enum-typed the operational status machines — `HousekeepingTaskType`, `HousekeepingStatus`, `MaintenanceCategory`, `MaintenanceStatus`, `PosOrderStatus`.
- **Go-live onboarding (new module 26, derived from the Objective):** `ImportBatch` + `ImportRow` + enums `ImportKind`/`ImportBatchStatus`/`ImportRowStatus` — bulk import of existing guests / historical bookings / opening balances (CSV/Excel), created via 04/03/06 (no foreign INSERTs). Schema now **70 models / 27 enums**; **27 modules** total.

## Proposed additive schema changes, by module
| Module | Additions to fold into `prisma/schema.prisma` |
|---|---|
| 00-platform | `PasswordResetToken`; `BackupRun`; `User.failedLoginCount/lockedUntil`; `AuditLog.reason` |
| 02-room-inventory | `RoomBlock(roomId, startDate, endDate, reason)` for date-ranged maintenance (vs status overload) |
| 04-guest-crm | search projection (`pg_trgm` GIN on `fullName` + hashed/deterministic `mobile`/`email` tokens); `Guest.mergedIntoId` |
| 06-billing-payments | `Invoice.type`(TAX_INVOICE/CREDIT_NOTE)`/cancelsInvoiceId`; `FolioLine.placeOfSupplyState`; `Payment.settlementBatchId` |
| 07-expense-management | `Expense.status` enum (DRAFT/APPROVED/REJECTED) |
| 09-staff-management | `Attendance.leaveType`; `Staff.department` enum; `StaffDocument` |
| 10-housekeeping | `HousekeepingTask.linenChanged/towelChanged/complaintText/raisedMaintenanceJobId` |
| 11-maintenance | `MaintenanceJob.priority` enum; link to `RoomBlock` |
| 12-communications | `MessageAutomation`; `Campaign`; `CommunicationConsent`; `MessagingAccount`; `MessageLog.category/scheduledFor/attempts/deadLetteredAt` |
| 13-channels | `ChannelSyncLog`; `ChannelAccount.certifiedAt/credentialsRef`; `Reservation.channelAccountId` |
| 14-analytics | `Property.currentBusinessDate/nightAuditTime` |
| 15-search-export | `ExportJob` |
| 16-security | `SecuritySettings`; `Session` (if DB-backed sessions) |
| 18-ai | `AiInteractionLog`; `GuestSegment` |
| 19-pos | `MenuItem`; `PosOutlet`; `PosOrder` settlement/tax columns |
| 20-inventory-stock | `RecipeComponent`; optional `PurchaseReceipt`; optional cached `InventoryItem.onHand` |
| 21-payroll | `PayrollRunStatus` enum; run/line finalize + payslip columns; `StaffAdvance` |
| 22-accounting-sync | `AccountingConfig` |
| 23-booking-engine | `BookingEngineConfig`; `BookingEngineOrder` |
| 24-dynamic-pricing | `DynamicRate.status`; category `floorPaise/ceilPaise` (or `PricingConfig`) |
| 25-corporate-crm | `NegotiatedRate`; corporate receivable derivation/cache |

## Open questions for the client / architect (decide before the affected module is built)
1. **Aadhaar full-storage flag** (`COMPLIANCE_STORE_FULL_AADHAAR`) — client legal sign-off; default OFF (masked). → 04, compliance.
2. **Provider choices for LIVE** (build-agnostic; affects activation only): WhatsApp BSP (Meta/Gupshup/Twilio), SMS provider + DLT, payment gateway (Razorpay/Cashfree), email (Resend/SES). → 12, 06, 23.
3. **Channel connectivity**: certified per-OTA partnership vs a channel-manager aggregator account. → 13.
4. **Accounting target**: Tally, Zoho Books, or both. → 22.
5. **Payroll statutory engines** (PF/ESI/PT/TDS): v1 treats these as manual deduction components — confirm whether auto-computation is required now. → 21.
6. **POS scope**: table management, KDS hardware, thermal-printer drivers, offline order capture, dynamic menu pricing are **out** of this build — confirm. → 19.
7. **Inventory procurement/PO workflow**: out of this build (movements only) — confirm. → 20.
8. **Negative-stock policy** (allow vs flag) and **payroll day-basis / OT multiplier** defaults — confirm the config defaults in `lib/constants/*`.

## Rule
Fold a module's deltas + a migration as **task T-1** of that module's `tasks.md`. Keep `prisma/schema.prisma` the single source of truth; update `docs/architecture/rbac-matrix.md` and `.claude/rules/data-model.md` if a delta changes a shared contract.
