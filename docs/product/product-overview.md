# Product Overview

Full steering: [`.claude/rules/product.md`](../../.claude/rules/product.md) · Scope: [`.claude/rules/scope.md`](../../.claude/rules/scope.md). This is the executive summary.

## Client & vision
**Woodpecker Apartments & Suites Pvt. Ltd.** — a multi-property serviced-apartments operator in India. One **mobile-first** platform, usable by non-technical staff on phone/tablet/laptop, that runs all daily operations across multiple properties from a single dashboard, with automated guest communication and AI assistance.

## Users
Reception (highest-frequency — optimise for speed), Manager/Owner (occupancy/revenue/profit), Accounts (billing/expenses/exports), Housekeeping (mobile, offline), Maintenance, Administrator.

## Scope — 26 modules, all built (nothing deferred)
Property & room inventory · reservations · guest CRM + history · GST billing & folio · expenses · profit reports · staff & payroll · housekeeping · maintenance · communications (WhatsApp/Email/SMS) · OTA/channel integration · dashboard & analytics · fast search & export · access control & security · mobile PWA · AI features · POS · stock inventory · accounting sync · online booking engine · dynamic pricing · corporate CRM.

## Success outcomes
1. Less manual work — booking-to-invoice with no double entry.
2. Complete, searchable guest relationship memory.
3. Money always correct — GST-compliant, folio never drifts.
4. No overbooking across direct + OTA channels.
5. Real-time business insight per property.
6. Automated, timely guest communication.
7. Learnable in minutes by non-technical staff.

## Competitive bar
MEWS / Cloudbeds / eZee-class — reached by getting the domain core right (folio, availability, night audit, event-driven automation), not by cutting corners. See [ADRs](../architecture/adr/).

## Key product decisions
Mobile-first **PWA** (one codebase, all devices — [ADR-0004](../architecture/adr/0004-pwa-not-native.md)) · **provider-agnostic** integrations, sandbox-by-default ([ADR-0003](../architecture/adr/0003-provider-abstraction.md)) · money in paise, time UTC + property-local ([ADR-0002](../architecture/adr/0002-money-and-time.md)) · modular monolith ([ADR-0001](../architecture/adr/0001-modular-monolith.md)) · India data region, Aadhaar masked by default pending client legal sign-off.
