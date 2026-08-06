import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { AUDIT_PAGE_SIZE, auditDb, type AuditRow } from "./internal";

export type AuditFilters = { action?: string; entityType?: string };

/**
 * A page of the immutable audit trail, newest first (§18). Admin-only, org-scoped,
 * cursor-paginated so it stays fast on a large table (NFR: no unbounded reads).
 */
export async function getAuditPage(
  filters: AuditFilters,
  cursor?: string,
): Promise<{ rows: AuditRow[]; nextCursor: string | null }> {
  const user = await requireUser();
  authorize(user, "user:manage");

  const where = {
    orgId: user.orgId,
    ...(filters.action ? { action: { contains: filters.action, mode: "insensitive" as const } } : {}),
    ...(filters.entityType ? { entityType: filters.entityType } : {}),
  };

  const rows = await auditDb.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: AUDIT_PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      createdAt: true,
      action: true,
      entityType: true,
      entityId: true,
      reason: true,
      ip: true,
      before: true,
      after: true,
      user: { select: { name: true, email: true } },
    },
  });

  const hasMore = rows.length > AUDIT_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, AUDIT_PAGE_SIZE) : rows;

  return {
    rows: page.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      reason: r.reason,
      ip: r.ip,
      before: r.before,
      after: r.after,
      actorName: r.user?.name ?? null,
      actorEmail: r.user?.email ?? null,
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}
