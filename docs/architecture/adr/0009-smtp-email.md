# ADR 0009 — SMTP email via nodemailer

**Status:** Accepted (2026-09-25)

## Context
The client wants automated guest emails (booking / check-in / checkout confirmations
and shared invoices) to actually deliver. `tech-stack.md` lists Resend / SES as the
email options, but those need a verified sending domain (SPF/DKIM) and a paid account.
The client's chosen path is simpler and immediate: send from their existing Gmail /
Google Workspace mailbox over **SMTP** with an app password.

`tech-stack.md` requires an ADR before adding a library outside the approved list.

## Decision
- Add **nodemailer** (`^8`, aligning with the `@auth/core` peer range) as the SMTP
  client. No Node built-in speaks SMTP; nodemailer is the de-facto standard and is
  already an optional peer of our auth stack.
- Implement it as one more adapter behind the existing `MessagingProvider` interface
  (`src/lib/messaging/smtp.ts`), selected when the EMAIL `MessagingAccount` is
  `mode="live"` with `provider="smtp"`. Sandbox/mock stays the default — the app
  still runs end-to-end with zero email credentials (integrations.md).
- Credentials come from **env only** (`SMTP_HOST/PORT/USER/PASS/FROM`), never the DB
  row or logs (security.md). Missing env → a non-throwing failed result, so the
  worker's retry/dead-letter path stays in control and the front desk is never blocked.
- nodemailer is imported lazily inside the send path, so it never loads in the
  sandbox/mock flow or on the request path.

## Consequences
- Going live on email is a config change (flip the account mode + set env), not a
  code change — consistent with the provider-abstraction rule (ADR 0003).
- Gmail limits (~500/day free, ~2000/day Workspace) are ample for this operator's
  transactional volume; if that ceiling is ever hit, swapping to Resend/SES is a new
  adapter behind the same interface, no call-site changes.
- Deliverability is best from a Workspace address on the hotel's own domain with
  SPF/DKIM; a plain @gmail.com works but is more likely flagged "via gmail".
