/** Shared internals for the audit-log browser (module 16 — §18 audit trail). */
import { db } from "@/lib/db";

/** AuditLog is org-level; reads are constrained by orgId + an admin authorize. */
export const auditDb = db.unscoped();

export const AUDIT_PAGE_SIZE = 40;

export type AuditRow = {
  id: string;
  createdAt: Date;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  ip: string | null;
  actorName: string | null;
  actorEmail: string | null;
  before: unknown;
  after: unknown;
};

/** Entity types offered as a filter (the common, high-traffic ones). */
export const AUDIT_ENTITY_TYPES = [
  "User",
  "Session",
  "Reservation",
  "Folio",
  "FolioLine",
  "Payment",
  "Invoice",
  "Guest",
  "Property",
  "Room",
  "Expense",
  "BookingEngineOrder",
] as const;
