# RBAC Matrix

Permissions are `module:action`. ✔ = allowed (within the user's property scope). Sensitive actions marked 🔒 are always audited. Admin has all permissions across all properties. This matrix is the source for the default role→permission map in `lib/permissions`.

| Permission | Admin | Manager | Reception | Accounts | Housekeeping | Maintenance |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| property:manage | ✔ | 🔒 | | | | |
| room:manage | ✔ | ✔ | | | | |
| room:view-status | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| reservation:view | ✔ | ✔ | ✔ | ✔ | | |
| reservation:create | ✔ | ✔ | ✔ | | | |
| reservation:modify | ✔ | ✔ | ✔ | | | |
| reservation:cancel | ✔ | ✔ | 🔒 | | | |
| checkin:perform | ✔ | ✔ | ✔ | | | |
| checkout:perform | ✔ | ✔ | ✔ | | | |
| guest:view | ✔ | ✔ | ✔ | ✔ | | |
| guest:view-pii | ✔ | 🔒 | 🔒 | 🔒 | | |
| guest:create | ✔ | ✔ | ✔ | | | |
| guest:delete | 🔒 | | | | | |
| folio:view | ✔ | ✔ | ✔ | ✔ | | |
| folio:charge | ✔ | ✔ | ✔ | ✔ | | |
| folio:discount | ✔ | 🔒 | 🔒 | 🔒 | | |
| folio:refund | 🔒 | 🔒 | | 🔒 | | |
| invoice:generate | ✔ | ✔ | ✔ | ✔ | | |
| invoice:void | 🔒 | 🔒 | | 🔒 | | |
| payment:record | ✔ | ✔ | ✔ | ✔ | | |
| expense:create | ✔ | ✔ | | ✔ | | |
| expense:approve | ✔ | 🔒 | | 🔒 | | |
| report:view-operational | ✔ | ✔ | ✔ | ✔ | | |
| report:view-financial | ✔ | ✔ | | ✔ | | |
| staff:manage | ✔ | ✔ | | | | |
| payroll:run | 🔒 | 🔒 | | 🔒 | | |
| housekeeping:update | ✔ | ✔ | ✔ | | ✔ | |
| maintenance:manage | ✔ | ✔ | | | | ✔ |
| communication:send | ✔ | ✔ | ✔ | ✔ | | |
| communication:template-manage | ✔ | 🔒 | | | | |
| integration:manage | 🔒 | | | | | |
| export:data | ✔ | ✔ | | ✔ | | |
| export:pii | 🔒 | 🔒 | | 🔒 | | |
| user:manage | 🔒 | | | | | |
| ai:use | ✔ | ✔ | ✔ | ✔ | | |
| settings:manage | 🔒 | 🔒 | | | | |
| folio:defer | 🔒 | 🔒 | | 🔒 | | |
| guest:manage | ✔ | ✔ | ✔ | | | |
| guest:merge | 🔒 | 🔒 | 🔒 | | | |
| pos:order-create | ✔ | ✔ | ✔ | ✔ | | |
| pos:order-settle | ✔ | ✔ | ✔ | ✔ | | |
| pos:order-void | 🔒 | 🔒 | | 🔒 | | |
| inventory:manage | ✔ | ✔ | | ✔ | | |
| pricing:approve | 🔒 | 🔒 | | | | |
| corporate:manage | ✔ | ✔ | | ✔ | | |
| bookingengine:manage | 🔒 | 🔒 | | | | |
| coupon:manage | ✔ | ✔ | | ✔ | | |
| data:import | 🔒 | 🔒 | | | | |

Notes: blanks = denied. `folio:defer` = allow checkout with unsettled balance (audited). `guest:manage` = create+update; `guest:merge` = merge duplicates (audited). `pricing:approve` = publish a dynamic rate. `corporate:manage` = corporate/agent + negotiated rates + credit limits. `bookingengine:manage` = public booking-engine config. `data:import` = go-live data onboarding (upload/validate/commit/rollback imports), Admin/Manager only, 🔒 audited. `coupon:manage` = create/pause/expire discount coupons + set limits (marketing); **redeeming** a valid coupon at booking/checkout needs no special permission — the pre-authorized discount is applied by 06, and the public booking engine applies it unauthenticated. Housekeeping/Maintenance never see rates, financials, or guest PII. Managers act only within assigned properties. Every 🔒 row writes an audit record with actor, target, and reason where required.
