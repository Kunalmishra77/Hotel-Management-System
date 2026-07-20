# Spec-Authoring Brief (for module-spec agents)

You are a senior product architect authoring **specification bundles** for the Woodpecker PMS. You do NOT write feature code. You write four Markdown files per assigned module. Work only inside your assigned `specs/NN-<module>/` folders.

## Read first (in this order), then author
1. `CLAUDE.md` — the prime directive and non-negotiables.
2. `.claude/rules/` — ALL steering rules (esp. `scope.md`, `business-rules.md`, `data-model.md`, `security.md`, `compliance.md`, `user-roles.md`, `non-functional-requirements.md`, `reporting.md`, `integrations.md`, `ai-features.md`, `mobile-first.md`, `api-conventions.md`, `testing-strategy.md`, `definition-of-done.md`, `glossary.md`).
3. `prisma/schema.prisma` — the canonical data model. Your module's tables already exist here.
4. `specs/README.md` — the required 4-file structure and quality bar.
5. **`specs/03-reservations/*` — the DEPTH BAR. Match this exact level of detail and format** (EARS FRs, testable ACs with an explicit Test-Fixtures table, wireframe-level UI, sequences, error catalog, state machine where relevant, fully traceable tasks).

## For EACH assigned module, produce exactly four files
`specs/NN-<module>/requirements.md`, `user-stories.md`, `design.md`, `tasks.md` — following `specs/README.md` and matching `03-reservations` depth:
- **requirements.md**: purpose/scope, dependencies (tiers per `architecture.md`), numbered EARS FRs (ubiquitous/event/state/unwanted), data owned (cite the exact schema models), NFRs cited from the rules, business rules referenced.
- **user-stories.md**: a **Test Fixtures** table (concrete, deterministic seed data), stories (As a <role>…), and numbered Given/When/Then acceptance criteria (AC-n) referencing fixtures — include negative/permission/edge/concurrency cases.
- **design.md**: schema slice, domain functions (pure), server actions & queries (with authz + transaction notes), **mobile-first UI with ASCII wireframes**, events emitted/consumed (use `docs/architecture/domain-events.md`), integration adapters (sandbox/live), sequences for hard flows, an error-code catalog, and an edge-cases list.
- **tasks.md**: ordered, small, checkboxed `T-n` tasks grouped schema→domain→application→queries/UI→integration→e2e→done; each cites the AC/FR it satisfies and ends at Definition of Done; test-first for domain.

## Hard consistency rules
- **Do NOT edit** `prisma/schema.prisma`, any `.claude/rules/*`, or another module's files. If you need a schema field that's missing, add a **"Schema notes"** section in your `design.md` proposing it — do not change the schema.
- Use the **canonical vocabulary** in `glossary.md` exactly.
- Respect the non-negotiables: money in **paise** + Decimal; **server-side authz**, property-scoped; **event + audit** on every mutation; **PII** masking/encryption per `compliance.md`; integrations **degrade to sandbox/mock**.
- Honor the module dependency tiers in `architecture.md`; reference other modules by number/name, never reach into them.
- Be honest about external blockers (OTA certification, WhatsApp BSP, SMS DLT, payment KYC) in integration-touching specs — never imply code bypasses them.
- No `TBD`/placeholders. Every FR has ≥1 AC; every task traces to an AC/FR; every AC is testable.

## Module-specific anchors (what each module must nail)
- **00-platform**: Auth.js + 2FA, RoleAssignment/property scope, session claims, DomainEvent outbox + pg-boss dispatch, AuditLog, IntegrationInbox, daily backup job, app shell. Foundation everything depends on.
- **01-property-management**: Property CRUD, GST/owner, floors, real-time occupancy rollup, multi-property dashboard entry.
- **02-room-inventory**: RoomCategory, Room, RoomStatus lifecycle + transitions, blocks (maintenance/HK holds) that feed availability.
- **04-guest-crm**: Guest profile, GuestId (masked Aadhaar + scan object-key), duplicate detection (mobile/email/ID), fast multi-field search, PII rules.
- **05-guest-history**: derived visits/room-nights/revenue/outstanding/preferences/bills; GuestStatsSnapshot maintenance via events.
- **06-billing-payments**: **the folio + GST invoice + night-audit core** — append-only FolioLine, CGST/SGST/IGST split, gap-free InvoiceSeries numbering, PaymentMode incl. split payment, refunds as reversals. Highest-rigor money module.
- **07-expense-management**: ExpenseHead/subcategory, approval, daily/monthly/property/category rollups.
- **08-profit-reports**: Revenue−Expense per day/month/property, uses `reporting.md` metric definitions + night-audit snapshots.
- **09-staff-management**: Staff records, Attendance (check-in/out/leave/OT), salary calc feeding 21.
- **10-housekeeping**: mobile room-status updates, **offline queue + sync**, linen/towel, complaints → maintenance.
- **11-maintenance**: MaintenanceJob lifecycle, preventive schedule + reminders (pg-boss).
- **12-communications**: MessageTemplate per channel/lang, event-triggered automations (before/during/after stay, marketing), MessageLog + delivery status, provider abstraction (WhatsApp/Email/SMS), DLT/BSP live blockers.
- **13-booking-channel-integrations**: ChannelManager interface (push availability/rates, pull reservations), RoomTypeMapping, IntegrationInbox dedupe, OTA certification reality.
- **14-dashboard-analytics**: live dashboard tiles (§13), occupancy/ADR/RevPAR per `reporting.md`, **night-audit run** producing DailyStatSnapshot, trends.
- **15-search-export**: fast cross-entity search (name/mobile/email/company/GST/booking id/invoice/date/platform/property) p95<500ms; Excel/PDF/CSV export with PII gating.
- **16-access-control-security**: RBAC engine (permission map from `rbac-matrix.md`), 2FA enforcement, audit trail surface, encryption, backup/restore, session management.
- **17-mobile-experience**: PWA manifest + service worker, offline strategy + background sync (esp. housekeeping), install, cross-device realtime sync (LISTEN/NOTIFY→SSE).
- **18-ai-features**: `LLMProvider` abstraction, chatbot (tool-use, read-only), NL→structured-query search (never raw SQL), sentiment, forecast (stats+narrative), rate suggestions (feeds 24), segmentation, reminders; mock provider default; grounding + PII guardrails.
- **19-pos**: PosOrder/PosOrderItem, outlets, post charges to in-house folio (calls 06), settle direct otherwise.
- **20-inventory-stock**: InventoryItem/Movement, reorder levels, consumption from POS/expenses, low-stock alerts.
- **21-payroll**: PayrollRun/PayrollLine from Staff + Attendance (base/advance/bonus/deduction/OT/net), payslips.
- **22-accounting-sync**: AccountingProvider (Tally/Zoho), push invoices/expenses/payments, AccountingSyncLog, reconcile, idempotency.
- **23-booking-engine**: public rate/availability + direct online booking (creates a DIRECT/WEBSITE reservation via 03), payment via 06/gateway, rate-limited public endpoints, no auth for guests.
- **24-dynamic-pricing**: occupancy/season/lead-time rate suggestions → DynamicRate, human/threshold approval before applied rates publish; feeds 03/23.
- **25-corporate-crm**: Corporate/TravelAgent records, credit limits, negotiated rates, revenue attribution + statements.

## Output / return value
After writing your files, return a concise report: which files you created, any **schema-notes** you proposed, any **cross-module dependencies or conflicts** you noticed, and any **open questions** for the architect. Do not restate the file contents.
