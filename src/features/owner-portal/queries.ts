/**
 * 27 owner-portal — read queries. Property-scoped; the owner sees ONLY properties
 * they own (`db.scoped(user)` + explicit `authorize(..., propertyId)`).
 *
 * Financials reuse the canonical reports/analytics computation (never recomputed),
 * but under the owner's own `owner:view-financials` permission — NOT the report
 * action's `report:view-financial`, which the owner does not hold (design gotcha).
 */
import { authorize, can } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { resolveStorageAdapter } from "@/lib/storage";
import { NotFoundError } from "@/lib/errors";
import { computeProfitReport, type ProfitReport } from "@/features/reports/queries";
import { trend } from "@/features/analytics/queries";
import { preventiveSchedule } from "@/features/maintenance/queries";
import type { SessionClaims } from "@/lib/auth/claims";
import { ownerDb, withOwnerContext } from "./internal";

export type OwnerFinancials = ProfitReport & {
  trend: { businessDate: string; value: number }[];
};

/** Revenue / expense / profit / occupancy + a revenue trend for one owned property. */
export async function ownerFinancials(
  user: SessionClaims,
  input: { propertyId: string; from: Date; to: Date },
): Promise<OwnerFinancials> {
  authorize(user, "owner:view-financials", input.propertyId);
  const propertyIds = [input.propertyId];
  const [report, revTrend] = await Promise.all([
    computeProfitReport(user, { propertyIds, from: input.from, to: input.to }),
    trend(user, { metric: "revenue", from: input.from, to: input.to, propertyIds }),
  ]);
  return { breakdown: report.breakdown, metrics: report.metrics, trend: revTrend };
}

// --- Document vault (FR-6/7/8) --------------------------------------------

/** Owner (owner:view-docs) OR staff-manager (owner:manage), property-scoped. */
function authorizeVaultRead(user: SessionClaims, propertyId: string): void {
  if (can(user, "owner:manage", propertyId)) return;
  authorize(user, "owner:view-docs", propertyId);
}

export type OwnerDocumentItem = {
  id: string;
  category: string;
  title: string;
  sizeBytes: number;
  contentType: string;
  uploadedByRole: string;
  createdAt: Date;
  canDelete: boolean;
};

export async function listOwnerDocuments(
  user: SessionClaims,
  input: { propertyId: string },
): Promise<OwnerDocumentItem[]> {
  authorizeVaultRead(user, input.propertyId);
  const isManager = can(user, "owner:manage", input.propertyId);
  const rows = await ownerDb(user).propertyDocument.findMany({
    where: { propertyId: input.propertyId, deletedAt: null },
    select: {
      id: true, category: true, title: true, sizeBytes: true, contentType: true,
      uploadedByRole: true, uploadedById: true, createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    title: r.title,
    sizeBytes: r.sizeBytes,
    contentType: r.contentType,
    uploadedByRole: r.uploadedByRole,
    createdAt: r.createdAt,
    // Manager may delete any; an owner only their own uploads (AC-9).
    canDelete: isManager || (r.uploadedByRole === "OWNER" && r.uploadedById === user.userId),
  }));
}

/** Fetch a vault document's bytes (authorized, non-public) + write an access-log audit. */
export async function getOwnerDocumentBytes(
  user: SessionClaims,
  documentId: string,
): Promise<{ filename: string; contentType: string; bytes: Buffer }> {
  const doc = await ownerDb(user).propertyDocument.findFirst({
    where: { id: documentId, deletedAt: null },
    select: { id: true, propertyId: true, title: true, objectKey: true, contentType: true },
  });
  if (!doc) throw new NotFoundError("Document not found.");
  authorizeVaultRead(user, doc.propertyId);

  const bytes = await resolveStorageAdapter().get(doc.objectKey);
  // Access-log the download (FR-7) — a read that reveals a stored document.
  await withOwnerContext(user, () =>
    writeAudit(ownerDb(user), {
      action: "owner:document-download",
      entityType: "PropertyDocument",
      entityId: doc.id,
      propertyId: doc.propertyId,
    }),
  );
  return { filename: `${doc.title}`, contentType: doc.contentType, bytes };
}

// --- Schedule (FR-9/10) ----------------------------------------------------

export type ImportantDateItem = {
  id: string;
  kind: string;
  label: string;
  dueDate: Date;
  notes: string | null;
  overdue: boolean;
};

export type OwnerScheduleView = {
  importantDates: ImportantDateItem[];
  maintenance: { id: string; roomNumber: string | null; description: string; scheduledFor: Date | null }[];
  occupancy: { businessDate: string; occupancyBps: number }[];
};

export async function ownerSchedule(
  user: SessionClaims,
  input: { propertyId: string; from: Date; to: Date },
): Promise<OwnerScheduleView> {
  authorize(user, "owner:view-schedule", input.propertyId);
  const todayIso = new Date().toISOString().slice(0, 10);

  const [dateRows, maint, occ] = await Promise.all([
    ownerDb(user).propertyImportantDate.findMany({
      where: { propertyId: input.propertyId, deletedAt: null },
      select: { id: true, kind: true, label: true, dueDate: true, notes: true },
      orderBy: { dueDate: "asc" },
    }),
    // Reuse module 11 (scope-only, no guest PII) — upcoming preventive jobs.
    preventiveSchedule(user, input.propertyId),
    // Occupancy as counts-equivalent %/day (no guest PII) via the unguarded trend.
    trend(user, { metric: "occupancy", from: input.from, to: input.to, propertyIds: [input.propertyId] }),
  ]);

  return {
    importantDates: dateRows.map((r) => ({
      id: r.id,
      kind: r.kind,
      label: r.label,
      dueDate: r.dueDate,
      notes: r.notes,
      overdue: r.dueDate.toISOString().slice(0, 10) < todayIso,
    })),
    maintenance: maint
      .filter((j) => j.status !== "CLOSED")
      .slice(0, 20)
      .map((j) => ({ id: j.id, roomNumber: j.roomNumber, description: j.description, scheduledFor: j.scheduledFor })),
    occupancy: occ.map((o) => ({ businessDate: o.businessDate, occupancyBps: o.value })),
  };
}
