/**
 * The default role → permission map.
 *
 * SOURCE OF TRUTH: docs/architecture/rbac-matrix.md. This file is a literal
 * transcription of that table — if the matrix changes, change it here and
 * nowhere else. `permission-map.test.ts` asserts the two stay in sync by
 * re-parsing the markdown, so drift fails CI rather than shipping.
 *
 * Legend in the matrix: ✔ = allowed · 🔒 = allowed AND always audited ·
 * blank = denied. Both ✔ and 🔒 grant; 🔒 additionally forces an audit row
 * (00 FR-14).
 */
import { RoleName } from "@prisma/client";

/** Every `module:action` string the app knows about. */
export const PERMISSIONS = [
  "property:manage",
  "room:manage",
  "room:view-status",
  "reservation:view",
  "reservation:create",
  "reservation:modify",
  "reservation:cancel",
  "checkin:perform",
  "checkout:perform",
  "guest:view",
  "guest:view-pii",
  "guest:create",
  "guest:delete",
  "folio:view",
  "folio:charge",
  "folio:discount",
  "folio:refund",
  "invoice:generate",
  "invoice:void",
  "payment:record",
  "expense:create",
  "expense:approve",
  "report:view-operational",
  "report:view-financial",
  "staff:manage",
  "payroll:run",
  "housekeeping:update",
  "maintenance:manage",
  "communication:send",
  "communication:template-manage",
  "integration:manage",
  "export:data",
  "export:pii",
  "user:manage",
  "ai:use",
  "settings:manage",
  "folio:defer",
  "guest:manage",
  "guest:merge",
  "pos:order-create",
  "pos:order-settle",
  "pos:order-void",
  "inventory:manage",
  "pricing:approve",
  "corporate:manage",
  "bookingengine:manage",
  "coupon:manage",
  "data:import",
  "owner:view-financials",
  "owner:view-payout",
  "owner:view-schedule",
  "owner:view-docs",
  "owner:upload-docs",
  "owner:manage",
  "owner:payout-manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

/** A cell in the matrix. */
type Grant = "allow" | "audited";

type MatrixRow = Partial<Record<RoleName, Grant>>;

const A: Grant = "allow";
const L: Grant = "audited"; // 🔒

/**
 * The matrix, row by row. Roles absent from a row are denied (deny-by-default,
 * FR-11) — there is deliberately no "everything else" fallthrough.
 */
const MATRIX: Record<Permission, MatrixRow> = {
  "property:manage": { ADMINISTRATOR: A, MANAGER: L },
  "room:manage": { ADMINISTRATOR: A, MANAGER: A, ASSISTANT_MANAGER: A },
  "room:view-status": {
    ADMINISTRATOR: A,
    MANAGER: A,
    ASSISTANT_MANAGER: A,
    RECEPTION: A,
    ACCOUNTS: A,
    INVENTORY_MANAGER: A,
    POS_MANAGER: A,
    HOUSEKEEPING: A,
    MAINTENANCE: A,
    SECURITY_SUPERVISOR: A,
    LAUNDRY_SUPERVISOR: A,
  },
  "reservation:view": { ADMINISTRATOR: A, MANAGER: A, ASSISTANT_MANAGER: A, RECEPTION: A, ACCOUNTS: A },
  "reservation:create": { ADMINISTRATOR: A, MANAGER: A, ASSISTANT_MANAGER: A, RECEPTION: A },
  "reservation:modify": { ADMINISTRATOR: A, MANAGER: A, ASSISTANT_MANAGER: A, RECEPTION: A },
  "reservation:cancel": { ADMINISTRATOR: A, MANAGER: A, ASSISTANT_MANAGER: L, RECEPTION: L },
  "checkin:perform": { ADMINISTRATOR: A, MANAGER: A, ASSISTANT_MANAGER: A, RECEPTION: A },
  "checkout:perform": { ADMINISTRATOR: A, MANAGER: A, ASSISTANT_MANAGER: A, RECEPTION: A },
  "guest:view": { ADMINISTRATOR: A, MANAGER: A, ASSISTANT_MANAGER: A, RECEPTION: A, ACCOUNTS: A },
  "guest:view-pii": { ADMINISTRATOR: A, MANAGER: L, ASSISTANT_MANAGER: L, RECEPTION: L, ACCOUNTS: L },
  "guest:create": { ADMINISTRATOR: A, MANAGER: A, ASSISTANT_MANAGER: A, RECEPTION: A },
  "guest:delete": { ADMINISTRATOR: L },
  "folio:view": { ADMINISTRATOR: A, MANAGER: A, ASSISTANT_MANAGER: A, RECEPTION: A, ACCOUNTS: A, POS_MANAGER: A },
  "folio:charge": { ADMINISTRATOR: A, MANAGER: A, ASSISTANT_MANAGER: A, RECEPTION: A, ACCOUNTS: A, POS_MANAGER: A },
  "folio:discount": { ADMINISTRATOR: A, MANAGER: L, ASSISTANT_MANAGER: L, RECEPTION: L, ACCOUNTS: L },
  "folio:refund": { ADMINISTRATOR: L, MANAGER: L, ACCOUNTS: L },
  "invoice:generate": { ADMINISTRATOR: A, MANAGER: A, ASSISTANT_MANAGER: A, RECEPTION: A, ACCOUNTS: A },
  "invoice:void": { ADMINISTRATOR: L, MANAGER: L, ACCOUNTS: L },
  "payment:record": { ADMINISTRATOR: A, MANAGER: A, ASSISTANT_MANAGER: A, RECEPTION: A, ACCOUNTS: A, POS_MANAGER: A },
  "expense:create": { ADMINISTRATOR: A, MANAGER: A, ASSISTANT_MANAGER: A, ACCOUNTS: A, PURCHASE_MANAGER: A },
  "expense:approve": { ADMINISTRATOR: A, MANAGER: L, ASSISTANT_MANAGER: L, ACCOUNTS: L },
  "report:view-operational": {
    ADMINISTRATOR: A,
    MANAGER: A,
    ASSISTANT_MANAGER: A,
    RECEPTION: A,
    ACCOUNTS: A,
    HR: A,
    INVENTORY_MANAGER: A,
    PURCHASE_MANAGER: A,
    POS_MANAGER: A,
    SECURITY_SUPERVISOR: A,
    LAUNDRY_SUPERVISOR: A,
  },
  "report:view-financial": { ADMINISTRATOR: A, MANAGER: A, ASSISTANT_MANAGER: A, ACCOUNTS: A },
  "staff:manage": { ADMINISTRATOR: A, MANAGER: A, ASSISTANT_MANAGER: A, HR: A },
  "payroll:run": { ADMINISTRATOR: L, MANAGER: L, ACCOUNTS: L, HR: L },
  "housekeeping:update": { ADMINISTRATOR: A, MANAGER: A, ASSISTANT_MANAGER: A, RECEPTION: A, HOUSEKEEPING: A },
  "maintenance:manage": { ADMINISTRATOR: A, MANAGER: A, ASSISTANT_MANAGER: A, MAINTENANCE: A },
  "communication:send": { ADMINISTRATOR: A, MANAGER: A, ASSISTANT_MANAGER: A, RECEPTION: A, ACCOUNTS: A },
  "communication:template-manage": { ADMINISTRATOR: A, MANAGER: L },
  "integration:manage": { ADMINISTRATOR: L },
  "export:data": {
    ADMINISTRATOR: A,
    MANAGER: A,
    ASSISTANT_MANAGER: A,
    ACCOUNTS: A,
    HR: A,
    INVENTORY_MANAGER: A,
    PURCHASE_MANAGER: A,
  },
  "export:pii": { ADMINISTRATOR: L, MANAGER: L, ACCOUNTS: L },
  "user:manage": { ADMINISTRATOR: L },
  "ai:use": {
    ADMINISTRATOR: A,
    MANAGER: A,
    ASSISTANT_MANAGER: A,
    RECEPTION: A,
    ACCOUNTS: A,
    HR: A,
    INVENTORY_MANAGER: A,
    PURCHASE_MANAGER: A,
    POS_MANAGER: A,
    SECURITY_SUPERVISOR: A,
    LAUNDRY_SUPERVISOR: A,
  },
  "settings:manage": { ADMINISTRATOR: L, MANAGER: L },
  "folio:defer": { ADMINISTRATOR: L, MANAGER: L, ACCOUNTS: L },
  "guest:manage": { ADMINISTRATOR: A, MANAGER: A, ASSISTANT_MANAGER: A, RECEPTION: A },
  "guest:merge": { ADMINISTRATOR: L, MANAGER: L, ASSISTANT_MANAGER: L, RECEPTION: L },
  "pos:order-create": { ADMINISTRATOR: A, MANAGER: A, ASSISTANT_MANAGER: A, RECEPTION: A, ACCOUNTS: A, POS_MANAGER: A },
  "pos:order-settle": { ADMINISTRATOR: A, MANAGER: A, ASSISTANT_MANAGER: A, RECEPTION: A, ACCOUNTS: A, POS_MANAGER: A },
  "pos:order-void": { ADMINISTRATOR: L, MANAGER: L, ACCOUNTS: L, POS_MANAGER: L },
  "inventory:manage": {
    ADMINISTRATOR: A,
    MANAGER: A,
    ASSISTANT_MANAGER: A,
    ACCOUNTS: A,
    INVENTORY_MANAGER: A,
    PURCHASE_MANAGER: A,
    POS_MANAGER: A,
    LAUNDRY_SUPERVISOR: A,
  },
  "pricing:approve": { ADMINISTRATOR: L, MANAGER: L },
  "corporate:manage": { ADMINISTRATOR: A, MANAGER: A, ASSISTANT_MANAGER: A, ACCOUNTS: A },
  "bookingengine:manage": { ADMINISTRATOR: L, MANAGER: L },
  "coupon:manage": { ADMINISTRATOR: A, MANAGER: A, ASSISTANT_MANAGER: A, ACCOUNTS: A },
  "data:import": { ADMINISTRATOR: L, MANAGER: L },
  // 27 owner-portal. Owner is read-only in their own scope except uploading own
  // docs; management + payout are staff-only (payout audited — money path).
  "owner:view-financials": { ADMINISTRATOR: A, MANAGER: A, OWNER: A },
  "owner:view-payout": { ADMINISTRATOR: A, MANAGER: A, OWNER: A },
  "owner:view-schedule": { ADMINISTRATOR: A, MANAGER: A, OWNER: A },
  "owner:view-docs": { ADMINISTRATOR: A, MANAGER: A, OWNER: A },
  "owner:upload-docs": { ADMINISTRATOR: A, OWNER: A },
  "owner:manage": { ADMINISTRATOR: A, MANAGER: A },
  "owner:payout-manage": { ADMINISTRATOR: L },
};

export const PERMISSION_MATRIX: Readonly<Record<Permission, MatrixRow>> = MATRIX;

function buildRoleMap(): Record<RoleName, ReadonlySet<Permission>> {
  const out = {} as Record<RoleName, Set<Permission>>;
  for (const role of Object.values(RoleName)) out[role] = new Set<Permission>();
  for (const permission of PERMISSIONS) {
    for (const [role, grant] of Object.entries(MATRIX[permission]) as [RoleName, Grant][]) {
      if (grant) out[role].add(permission);
    }
  }
  return out;
}

/** role → the permissions it grants by default. */
export const PERMISSION_MAP: Readonly<Record<RoleName, ReadonlySet<Permission>>> = buildRoleMap();

/**
 * Permissions marked 🔒 for at least one role. Performing one always writes an
 * audit record (FR-14), regardless of which role the caller holds — an
 * Administrator refunding is as audit-worthy as an Accounts user refunding.
 */
export const AUDITED_PERMISSIONS: ReadonlySet<Permission> = new Set(
  PERMISSIONS.filter((p) => Object.values(MATRIX[p]).some((g) => g === "audited")),
);

/**
 * The subset of 🔒 permissions whose audit record must also carry a `reason`
 * (FR-14: "where the matrix mandates one"). Each entry is backed by an explicit
 * `reason` parameter in the owning module's spec:
 *   guest:view-pii   — 04 FR-9  / design.md `revealPii(guestId, field, reason)`
 *   export:pii       — 15 FR-5  / 04 design.md `exportGuestData` (audited PII egress)
 *   guest:delete     — 04 FR-14 / DPDP erasure must record why data was scrubbed
 *   folio:discount   — 06 design.md `applyDiscount(folioId, amountPaise, reason, …)`
 *   folio:refund     — 06 design.md `refund(folioId, amountPaise, reason)`
 *   folio:defer      — rbac-matrix note: checkout with an unsettled balance
 *   invoice:void     — 06 design.md `voidInvoice(invoiceId, reason)`
 *   pos:order-void   — 19 design.md `voidOrder(orderId, reason)`
 *   reservation:cancel — 03 design.md `cancelReservation(id, reason)`
 * Permissions such as `payroll:run` are 🔒 but do not mandate a reason at the
 * permission level; 21 FR-13 requires one only for a derived-component override.
 */
export const REASON_REQUIRED_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  "guest:view-pii",
  "export:pii",
  "guest:delete",
  "folio:discount",
  "folio:refund",
  "folio:defer",
  "invoice:void",
  "pos:order-void",
  "reservation:cancel",
]);

export function isAuditedPermission(permission: Permission): boolean {
  return AUDITED_PERMISSIONS.has(permission);
}

export function requiresReason(permission: Permission): boolean {
  return REASON_REQUIRED_PERMISSIONS.has(permission);
}
