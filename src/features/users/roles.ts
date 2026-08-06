import { RoleName } from "@prisma/client";

/** Human labels for the 13 login roles — used in the user-admin UI and menus. */
export const ROLE_LABELS: Record<RoleName, string> = {
  ADMINISTRATOR: "Administrator",
  MANAGER: "Hotel Manager",
  ASSISTANT_MANAGER: "Assistant Manager",
  RECEPTION: "Reception",
  ACCOUNTS: "Accounts",
  HR: "HR",
  INVENTORY_MANAGER: "Inventory Manager",
  PURCHASE_MANAGER: "Purchase Manager",
  POS_MANAGER: "POS / Restaurant Manager",
  HOUSEKEEPING: "Housekeeping Supervisor",
  MAINTENANCE: "Maintenance Supervisor",
  SECURITY_SUPERVISOR: "Security Supervisor",
  LAUNDRY_SUPERVISOR: "Laundry Supervisor",
};

/** Display order (governance → ops), matching rbac-matrix.md. */
export const ROLE_ORDER: RoleName[] = [
  "ADMINISTRATOR",
  "MANAGER",
  "ASSISTANT_MANAGER",
  "RECEPTION",
  "ACCOUNTS",
  "HR",
  "INVENTORY_MANAGER",
  "PURCHASE_MANAGER",
  "POS_MANAGER",
  "HOUSEKEEPING",
  "MAINTENANCE",
  "SECURITY_SUPERVISOR",
  "LAUNDRY_SUPERVISOR",
];

/** Org-wide roles have no property scope (empty propertyIds = all properties). */
export const ORG_WIDE_ROLES: ReadonlySet<RoleName> = new Set<RoleName>(["ADMINISTRATOR"]);
