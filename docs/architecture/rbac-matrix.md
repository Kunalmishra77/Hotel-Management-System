# RBAC Matrix

Permissions are `module:action`. ✔ = allowed (within the user's property scope). Sensitive actions marked 🔒 are always audited. Admin has all permissions across all properties. This matrix is the source for the default role→permission map in `lib/permissions`.

Columns are the 14 login roles (staff without a login — housekeeping/room-service/security-guard/etc. — are managed by their supervisor and never appear here). Asst = Assistant Manager · Inv = Inventory/Store Manager · Pur = Purchase Manager · POS = POS/Restaurant Manager · Sec = Security Supervisor · Laundry = Laundry Supervisor · Owner = Property Owner (read-only portal; sees only their own properties — financials, documents, schedule, payouts; the only owner write is uploading their own documents).

| Permission | Admin | Manager | Asst | Reception | Accounts | HR | Inv | Pur | POS | Housekeeping | Maintenance | Sec | Laundry | Owner |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| property:manage | ✔ | 🔒 |  |  |  |  |  |  |  |  |  |  |  |  |
| room:manage | ✔ | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |  |
| room:view-status | ✔ | ✔ | ✔ | ✔ |  |  | ✔ |  | ✔ | ✔ | ✔ | ✔ | ✔ |  |
| reservation:view | ✔ | ✔ | ✔ | ✔ | ✔ |  |  |  |  |  |  |  |  |  |
| reservation:create | ✔ | ✔ | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |
| reservation:modify | ✔ | ✔ | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |
| reservation:cancel | ✔ | ✔ | 🔒 | 🔒 |  |  |  |  |  |  |  |  |  |  |
| checkin:perform | ✔ | ✔ | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |
| checkout:perform | ✔ | ✔ | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |
| guest:view | ✔ | ✔ | ✔ | ✔ | ✔ |  |  |  |  |  |  |  |  |  |
| guest:view-pii | ✔ | 🔒 | 🔒 | 🔒 | 🔒 |  |  |  |  |  |  |  |  |  |
| guest:create | ✔ | ✔ | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |
| guest:delete | 🔒 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| folio:view | ✔ | ✔ | ✔ | ✔ | ✔ |  |  |  | ✔ |  |  |  |  |  |
| folio:charge | ✔ | ✔ | ✔ | ✔ | ✔ |  |  |  | ✔ |  |  |  |  |  |
| folio:discount | ✔ | 🔒 | 🔒 | 🔒 | 🔒 |  |  |  |  |  |  |  |  |  |
| folio:refund | 🔒 | 🔒 |  |  | 🔒 |  |  |  |  |  |  |  |  |  |
| invoice:generate | ✔ | ✔ | ✔ | ✔ | ✔ |  |  |  |  |  |  |  |  |  |
| invoice:void | 🔒 | 🔒 |  |  | 🔒 |  |  |  |  |  |  |  |  |  |
| payment:record | ✔ | ✔ | ✔ | ✔ | ✔ |  |  |  | ✔ |  |  |  |  |  |
| expense:create | ✔ | ✔ | ✔ |  | ✔ |  |  | ✔ |  |  |  |  |  |  |
| expense:approve | ✔ | 🔒 | 🔒 |  | 🔒 |  |  |  |  |  |  |  |  |  |
| report:view-operational | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |  |  | ✔ | ✔ |  |
| report:view-financial | ✔ | ✔ | ✔ |  | ✔ |  |  |  |  |  |  |  |  |  |
| staff:manage | ✔ | ✔ | ✔ |  |  | ✔ |  |  |  |  |  |  |  |  |
| attendance:record | ✔ | ✔ | ✔ | ✔ |  | ✔ |  |  |  |  |  |  |  |  |
| staff:salary-update | 🔒 | 🔒 | 🔒 | 🔒 |  | 🔒 |  |  |  |  |  |  |  |  |
| payroll:run | 🔒 | 🔒 |  |  | 🔒 | 🔒 |  |  |  |  |  |  |  |  |
| housekeeping:update | ✔ | ✔ | ✔ | ✔ |  |  |  |  |  | ✔ |  |  |  |  |
| maintenance:manage | ✔ | ✔ | ✔ |  |  |  |  |  |  |  | ✔ |  |  |  |
| communication:send | ✔ | ✔ | ✔ | ✔ | ✔ |  |  |  |  |  |  |  |  |  |
| communication:template-manage | ✔ | 🔒 |  |  |  |  |  |  |  |  |  |  |  |  |
| integration:manage | 🔒 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| export:data | ✔ | ✔ | ✔ |  | ✔ | ✔ | ✔ | ✔ |  |  |  |  |  |  |
| export:pii | 🔒 | 🔒 |  |  | 🔒 |  |  |  |  |  |  |  |  |  |
| user:manage | 🔒 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| ai:use | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |  |  | ✔ | ✔ |  |
| settings:manage | 🔒 | 🔒 |  |  |  |  |  |  |  |  |  |  |  |  |
| folio:defer | 🔒 | 🔒 |  |  | 🔒 |  |  |  |  |  |  |  |  |  |
| guest:manage | ✔ | ✔ | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |
| guest:merge | 🔒 | 🔒 | 🔒 | 🔒 |  |  |  |  |  |  |  |  |  |  |
| request:manage | ✔ | ✔ | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |
| pos:order-create | ✔ | ✔ | ✔ | ✔ |  |  |  |  | ✔ |  |  |  |  |  |
| pos:order-settle | ✔ | ✔ | ✔ | ✔ | ✔ |  |  |  | ✔ |  |  |  |  |  |
| pos:order-void | 🔒 | 🔒 |  |  | 🔒 |  |  |  | 🔒 |  |  |  |  |  |
| inventory:manage | ✔ | ✔ | ✔ |  |  |  | ✔ | ✔ | ✔ |  |  |  | ✔ |  |
| pricing:approve | 🔒 | 🔒 |  |  |  |  |  |  |  |  |  |  |  |  |
| corporate:manage | ✔ | ✔ | ✔ |  | ✔ |  |  |  |  |  |  |  |  |  |
| bookingengine:manage | 🔒 | 🔒 |  |  |  |  |  |  |  |  |  |  |  |  |
| coupon:manage | ✔ | ✔ | ✔ |  | ✔ |  |  |  |  |  |  |  |  |  |
| data:import | 🔒 | 🔒 |  |  |  |  |  |  |  |  |  |  |  |  |
| owner:view-financials | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |  | ✔ |
| owner:view-payout | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |  | ✔ |
| owner:view-schedule | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |  | ✔ |
| owner:view-docs | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |  | ✔ |
| owner:upload-docs | ✔ |  |  |  |  |  |  |  |  |  |  |  |  | ✔ |
| owner:manage | ✔ | ✔ |  |  |  |  |  |  |  |  |  |  |  |  |
| owner:payout-manage | 🔒 |  |  |  |  |  |  |  |  |  |  |  |  |  |

Notes: blanks = denied. **Assistant Manager** is the manager's deputy — full daily operations, but high-risk/config actions (refund, void, settings, integrations, pricing publish, property, user-admin, data-import) escalate to the Manager. **HR** owns staff + payroll only. **Inventory** and **Purchase** managers own stock/procurement (purchase orders themselves are approved by the Manager). **POS/Restaurant Manager** runs outlets and posts F&B to the folio. **Security** and **Laundry** supervisors are operational-only (status + their department + AI). `folio:defer` = allow checkout with unsettled balance (audited). `guest:manage` = create+update; `guest:merge` = merge duplicates (audited). `pricing:approve` = publish a dynamic rate. `corporate:manage` = corporate/agent + negotiated rates + credit limits. `bookingengine:manage` = public booking-engine config. `data:import` = go-live data onboarding (Admin/Manager only, 🔒 audited). `coupon:manage` = create/pause/expire discount coupons; **redeeming** a valid coupon needs no special permission. Supervisors never see rates, financials, or guest PII. Managers act only within assigned properties. Every 🔒 row writes an audit record with actor, target, and reason where required.
