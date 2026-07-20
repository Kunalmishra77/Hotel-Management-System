# Coding Standards

## Language
- TypeScript strict; no `any` (use `unknown` + narrowing). No non-null `!` without a guarded reason.
- Prefer pure functions in `domain/`; side effects live in application/infrastructure.
- Explicit return types on exported functions and server actions.

## Naming
- Files: kebab-case (`create-reservation.ts`). React components: PascalCase file+export. Hooks: `useX`. Zod schemas: `xSchema`. Server actions: verb-first (`createReservation`).
- Money variables carry unit: `totalPaise`, `ratePaise`. Dates carry zone intent: `checkInDate` (local), `createdAt` (UTC instant).

## Structure & size
- One responsibility per file. `features/*` files ≤ ~300 lines; split when larger.
- Module public surface = `actions.ts`, `queries.ts`, `schema.ts`, `events.ts`. Everything else is internal.
- No cross-module deep imports. Import from a module's public surface only.

## Errors
- Throw typed domain errors (`DomainError` subclasses); map to user-safe messages at the action boundary. Never leak stack/PII to the client.
- Validate all input with zod at the boundary; treat validated types as trusted inward.

## React / Next
- Server Components by default; `"use client"` only when interactivity needs it.
- Mutations via Server Actions; reads via `queries.ts` (+ TanStack Query on the client where live).
- No business logic in components — call actions/queries.

## Comments
- Comment the **why**, not the what. Document invariants and non-obvious money/tax/timezone decisions inline.

## Formatting
- Prettier + ESLint enforced by Husky pre-commit (typecheck + lint + related tests must pass). No disabling lint rules without justification.
