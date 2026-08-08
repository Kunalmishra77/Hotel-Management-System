# ADR-0007: In-app QR generation via the `qrcode` library

- **Status:** Accepted
- **Date:** 2026-08-08
- **Deciders:** Principal Architect, Lead Dev

## Context
The guest in-room ordering feature (module 19 addendum, `specs/19-pos` FR-19) needs
a scannable QR per room, rendered and printable from the room detail page so staff
can place a permanent placard. `tech-stack.md` forbids adding a dependency without
an ADR. Generating a correct, error-corrected QR (byte encoding, masking, ECC) is
non-trivial and not something to hand-roll.

## Decision
Add **`qrcode`** (MIT, ~single-purpose, zero runtime deps of note) to render the
per-room ordering URL as a QR. Use it **server-side** to produce a data-URI / SVG
that the room page embeds — no client bundle cost on other routes, no external
network call (self-contained, works offline, satisfies the same no-CDN posture as
the PWA). The QR only ever encodes a public, non-secret-bearing ordering URL
(`…/order/<orderToken>`); the token's safety comes from the occupied-gate +
rate-limit (FR-20/26), not from hiding the QR.

## Consequences
- **Positive:** correct, standards-compliant QR with error correction; printable
  placards; no external service; small, focused, well-maintained dependency.
- **Negative:** one more dependency to track/audit (bounded — used only in the room
  page's QR render path).
- **Follow-up:** if a future need arises for styled/branded QRs, revisit; not in
  scope now.

## Alternatives considered
- **Hand-rolled QR encoder** — rejected: encoding + ECC + masking is easy to get
  subtly wrong (unscannable codes), far more code to own than the dependency saves.
- **Show the ordering URL as text only (no dep)** — rejected for the primary flow:
  staff would need an external tool to turn each room's URL into a physical QR,
  defeating "a scanner in every room." (The URL is still copyable as a fallback.)
- **External QR image service (e.g. a QR API)** — rejected: adds a network
  dependency + a CDN/external call, against the self-contained/offline posture and
  `integrations.md`'s "no unnecessary external providers."
