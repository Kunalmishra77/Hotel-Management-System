/**
 * The domain-event catalogue — docs/architecture/domain-events.md.
 *
 * That document says: "This is the authoritative list — a design that emits an
 * event not here must add it." Typing `emitEvent` against this union is what
 * makes that rule enforceable at compile time instead of at review time.
 *
 * 00-platform owns only the envelope and the dispatch mechanism; the event
 * names themselves belong to their emitting modules and are listed here so the
 * catalogue stays in one place.
 */
export const DOMAIN_EVENT_TYPES = [
  // 00 platform / 16 access control
  "UserCreated",
  "UserSignedIn",
  "RoleAssigned",
  "PermissionOverrideChanged",
  "SecuritySettingsChanged",
  "BackupTriggered",
  "SessionForceLoggedOut",

  // 01 property
  "PropertyCreated",
  "PropertyUpdated",
  "PropertyDeactivated",

  // 02 room inventory
  "RoomCreated",
  "CategoryCreated",
  "RoomStatusChanged",

  // 03 reservations
  "ReservationCreated",
  "ReservationModified",
  "ReservationCancelled",
  "NoShowMarked",
  "GuestCheckedIn",
  "GuestCheckedOut",
  "RegistrationCardCaptured",
  "CFormGenerated",
  "CFormSubmitted",

  // 04 guest CRM
  "GuestCreated",
  "GuestUpdated",
  "GuestIdAdded",
  "GuestPiiAccessed",
  "GuestMerged",
  "GuestErased",

  // 05 guest history
  "GuestStatsUpdated",

  // 06 billing
  "FolioCharged",
  "DiscountApplied",
  "CouponRedeemed",
  "PaymentReceived",
  "PaymentRefunded",
  "InvoiceIssued",
  "PaymentDueDetected",
  "CorporateReceivableChanged",

  // 07 expenses
  "ExpenseRecorded",
  "ExpenseApproved",

  // 09 staff
  "StaffCreated",
  "StaffUpdated",
  "AttendanceRecorded",

  // 10 housekeeping / 11 maintenance
  "HousekeepingTaskDone",
  "MaintenanceJobCreated",
  "MaintenanceJobClosed",
  "MaintenanceScheduled",

  // 12 communications
  "MessageQueued",
  "ConsentChanged",
  "FeedbackReceived",

  // 13 channels
  "ChannelReservationPulled",
  "ChannelPushed",
  "ChannelOversellDetected",

  // 14 analytics
  "NightAuditCompleted",

  // 15 search/export
  "DataExported",

  // 18 AI
  "SentimentClassified",
  "SegmentUpdated",
  "RateSuggested",

  // 19 POS
  "PosOrderSettled",
  "PosOrderVoided",
  // 19 addendum: guest QR ordering + kitchen lifecycle
  "GuestOrderRequested",
  "KitchenTicketMoved",

  // 20 inventory
  "StockMovementRecorded",
  "LowStockDetected",

  // 21 payroll
  "PayrollRunGenerated",
  "PayrollLineAdjusted",
  "PayrollFinalized",

  // 22 accounting sync
  "AccountingSynced",
  "AccountingSyncFailed",

  // 23 booking engine
  "WebBookingConfirmed",
  "WebBookingFailed",
  "WebBookingCancelled",

  // 24 dynamic pricing
  "DynamicRateApproved",
  "DynamicRateRejected",

  // 25 corporate CRM
  "CorporateCreated",
  "AgentCreated",
  "NegotiatedRateSet",
  "CreditThresholdReached",

  // 26 data onboarding
  "ImportCommitted",
  "ImportRolledBack",

  // 27 owner portal
  "PropertyDocumentUploaded",
  "PropertyDocumentDeleted",
  "ImportantDateChanged",
  "OwnerPayoutRecorded",
  "OwnerPayoutPaid",
] as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

const EVENT_TYPE_SET: ReadonlySet<string> = new Set(DOMAIN_EVENT_TYPES);

export function isDomainEventType(value: string): value is DomainEventType {
  return EVENT_TYPE_SET.has(value);
}
