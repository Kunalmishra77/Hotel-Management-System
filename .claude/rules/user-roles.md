# User Roles & Access

Six roles (§15). RBAC is **permission-based**: roles are bundles of permissions; the app checks permissions, not role names. Enforced server-side on every action (`security.md`). Full grid: `docs/architecture/rbac-matrix.md`.

## Roles
| Role | Purpose | Property scope |
|---|---|---|
| **Administrator** | System owner: users, roles, properties, config, integrations | All properties |
| **Manager** | Runs one or more properties: full ops + reports | Assigned properties |
| **Reception** | Front desk: reservations, check-in/out, folio, payments, guest CRM | Assigned property |
| **Accounts** | Billing, payments, expenses, exports, accounting sync, reports | Assigned properties |
| **Housekeeping** | Update room status, linen, report complaints | Assigned property |
| **Maintenance** | View/close maintenance jobs, preventive schedule | Assigned property |

## Permission model
- Permission = `module:action` (e.g. `reservation:create`, `folio:refund`, `expense:approve`, `report:view-financial`, `user:manage`).
- A user has one or more role assignments, each scoped to specific properties.
- **Least privilege**: housekeeping/maintenance see operational status, never financials or guest PII beyond what their job needs (e.g. no Aadhaar, no rates).
- Sensitive actions (refunds, discounts beyond a threshold, void invoice, delete guest, export PII) require an elevated permission and are always audited.

## Rules
- The UI hides what a user can't do, but hiding is not security — the server re-checks.
- Data queries are property-scoped to the user's assignments by default.
- Role/permission changes are audit-logged and take effect on next request (session claims refreshed).
