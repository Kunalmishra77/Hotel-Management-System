# ADR-0002: Money as integer paise; time as UTC + property-local dates

- **Status:** Accepted
- **Date:** 2026-07-18

## Context
Financial correctness is a core outcome; GST rounding and multi-property operation across a midnight boundary are error-prone with floats and naive dates.

## Decision
- Money of record = **integer paise** (`Int`/`BigInt`). All arithmetic via **Decimal.js**; round half-up to paisa at line level per GST. No float/decimal currency columns.
- Timestamps stored **UTC**; business/calendar dates that are property-local (booking dates, business date, attendance) stored as `@db.Date` and interpreted via the property timezone. Night audit defines the business-date boundary.

## Consequences
- (+) No floating-point drift; GST and folio balances exact and auditable.
- (+) Correct across time zones and the post-midnight window.
- (−) Developers must respect units (`...Paise`) and convert at edges; enforced by naming + review.

## Alternatives
- Decimal columns — still risks mixed float math in JS; rejected.
- Store local wall-clock — breaks under DST/tz and multi-property reporting; rejected.
