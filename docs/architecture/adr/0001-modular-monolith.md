# ADR-0001: Modular monolith on Next.js

- **Status:** Accepted
- **Date:** 2026-07-18

## Context
26 modules, one small ops team, must ship the whole scope and run cheaply. Options: (a) microservices, (b) Next.js frontend + separate NestJS API, (c) modular monolith on Next.js.

## Decision
Modular monolith on Next.js App Router. Server Actions + Route Handlers are the API. Hard module boundaries via `features/*` with a public surface (`actions/queries/schema/events`). Async work in a pg-boss worker.

## Consequences
- (+) One deployable, minimal ops, fastest path to full scope, cheap hosting.
- (+) Boundaries + events keep it from becoming a big ball of mud; a module can be extracted to a service later if load demands.
- (−) Everything shares a process/DB; must enforce boundaries by discipline + lint, not network.
- Follow-up: boundary lint rule; load-test the booking path before considering extraction.

## Alternatives
- Microservices — premature; operational cost unjustified at this scale.
- Separate API service — extra moving parts now; revisit only if a large non-web API surface appears.
