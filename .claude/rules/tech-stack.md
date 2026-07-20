# Tech Stack

**Do not add libraries outside this list without an ADR** (`docs/architecture/adr/`). Fewer dependencies = smaller surface, less token cost, easier audit.

## Core
- **Next.js 15** (App Router, Server Actions) · **React 19** · **TypeScript 5** (strict, `noUncheckedIndexedAccess`)
- **PostgreSQL** + **Prisma 6** (ORM, migrations, single schema source of truth)
- **Auth.js v5 (next-auth)** — credentials + TOTP 2FA (`otplib`), sessions
- **Zod** — every input boundary validated; zod schemas live in `features/*/schema.ts`
- **TanStack Query** — client cache/sync · **Zustand** — light client state
- **Tailwind CSS** + **shadcn/ui** (Radix) — mobile-first components
- **Decimal.js** — all money math · money stored as integer paise (see `data-model.md`)
- **date-fns** — dates; store UTC, present property-local

## Platform services (no extra infra)
- **pg-boss** — job queue on Postgres (reminders, OTA sync, forecasts, backups, event dispatch)
- **Realtime** — Postgres `LISTEN/NOTIFY` → SSE/WebSocket for live occupancy & cross-device sync
- **Object storage** — S3-compatible (AWS S3 `ap-south-1` or self-hosted MinIO) for ID scans/images

## Documents & data
- **exceljs** (Excel) · **@react-pdf/renderer** (GST invoices, PDF exports) · CSV via streamed writer

## Integrations (all behind interfaces in `lib/integrations`, `lib/messaging`, `lib/payments`, `lib/ai`)
- Payments: Razorpay / Cashfree · Messaging: Meta WhatsApp Cloud / Gupshup / Twilio, MSG91 (SMS+DLT), Resend/SES (email)
- AI: provider-agnostic (Anthropic / OpenAI / local) — see `ai-features.md`
- OTA: channel-manager connector interface · Accounting: Tally / Zoho Books

## Tooling
- **Vitest** (unit/integration) · **Playwright** (e2e) · **ESLint** (next) · **Prettier** · **Husky** (pre-commit: typecheck + lint + related tests)

## Explicitly NOT used (avoid scope creep)
- No Redis unless a load test proves pg-boss/LISTEN-NOTIFY insufficient (needs ADR).
- No separate GraphQL/REST backend — server actions + route handlers are the API.
- No CSS-in-JS runtime — Tailwind only.
- No ORM other than Prisma; no raw SQL except vetted reporting queries.
