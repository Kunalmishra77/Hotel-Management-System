/**
 * Audit trail — 00 T-13 (FR-15/16, AC-14/15).
 *
 * "When any business mutation commits, write an immutable AuditLog row … in the
 * SAME transaction as the state change. The actor fields (orgId, userId,
 * requestId, ip, device) are supplied by the per-request context
 * (AsyncLocalStorage) rather than passed by each caller."
 *
 * Taking `tx` as the first argument is deliberate and not a style choice: it
 * makes "same transaction" the only way to call this. A version that reached
 * for a global client would let the state change commit while the audit row
 * silently failed.
 *
 * Append-only is enforced in the database too (the auditlog_append_only
 * trigger, migration 20260721120000_platform_init) — application discipline
 * alone is not a guarantee.
 */
import type { Prisma } from "@prisma/client";
import { getContext, SYSTEM_USER_ID } from "../context";
import { redact } from "../logger";

/**
 * The minimum a transaction client must offer to write an audit row.
 *
 * Declared structurally rather than as `Prisma.TransactionClient` so that an
 * EXTENDED client works too — `db.scoped(user)` returns a `$extends`-ed client
 * whose transaction type is nominally different but functionally identical.
 * Naming only what is used also states the real dependency: this function needs
 * the ability to insert one row, nothing more.
 */
export type AuditCapableTx = {
  auditLog: {
    create(args: { data: Prisma.AuditLogUncheckedCreateInput }): Promise<unknown>;
  };
};

type Tx = AuditCapableTx;

export type AuditEntry = {
  /** `module:action`, matching the permission that gated it. */
  action: string;
  entityType: string;
  entityId: string;
  /** Required for 🔒 actions the RBAC matrix mandates a reason for (FR-14). */
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  /** Only when the row is not property-scoped or context lacks it. */
  propertyId?: string | null;
  /** Escape hatch for jobs running outside a request context. */
  orgId?: string;
  userId?: string | null;
};

/**
 * PII-redact a before/after snapshot before persistence (FR-16).
 *
 * Reuses the logger's key-pattern redaction so "what counts as PII" is defined
 * once. An audit row records THAT a field changed, never the sensitive value.
 */
function redactSnapshot(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return redact(value) as Prisma.InputJsonValue;
}

/**
 * Write an audit row inside the caller's transaction.
 *
 * Throws if there is no request context and no explicit orgId — an audit row
 * without an actor is worse than useless, so failing loudly (and rolling back
 * the mutation with it) is the correct outcome.
 */
export async function writeAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  const ctx = getContext();

  const orgId = entry.orgId ?? ctx?.orgId;
  if (!orgId) {
    throw new Error(
      `writeAudit("${entry.action}") has no orgId: it must run inside runWithContext(), ` +
        "or pass orgId explicitly (background jobs use runWithSystemContext()).",
    );
  }

  // The system actor ("worker") has no User row — record it as a null userId
  // (the `device: "worker"` field already marks it as background work). A literal
  // "system" would violate AuditLog_userId_fkey.
  const rawUserId = entry.userId ?? ctx?.userId ?? null;
  const userId = rawUserId === SYSTEM_USER_ID ? null : rawUserId;

  await tx.auditLog.create({
    data: {
      orgId,
      propertyId: entry.propertyId ?? ctx?.activePropertyId ?? null,
      userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      reason: entry.reason ?? null,
      before: redactSnapshot(entry.before),
      after: redactSnapshot(entry.after),
      requestId: ctx?.requestId ?? null,
      ip: ctx?.ip ?? null,
      device: ctx?.device ?? null,
    },
  });
}
