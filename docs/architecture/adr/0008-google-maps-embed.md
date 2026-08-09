# ADR-0008 — Google Maps embed for field-staff locations (key-gated, degrades to deep-links)

**Status:** Accepted (2026-08-10)

## Context
MoM line 32 asks for field-staff locations "with Google-location mapping." Field-staff tracking (09 addendum) already captures coordinates (browser Geolocation) and shows each staff member's last-known position as a **Google Maps deep-link** (`https://www.google.com/maps?q=lat,lng`) — which needs no credentials and works today.

An **embedded, interactive** Google Map (in-page tiles/pins) needs the Google Maps Platform (Embed API or Maps JavaScript API), which requires a **billed API key**. Per `tech-stack.md` an external dependency of this kind needs an ADR; per `integrations.md` the app must run end-to-end with **zero external accounts**, degrading gracefully when credentials are absent.

## Decision
- Add an **optional, key-gated** embedded map using the Google Maps **Embed API** (a plain `<iframe>` — no SDK/script, lightest surface).
- The key is read from `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. When it is **set**, the field-staff view can expand an inline map for a staff member's last-known coordinates. When it is **absent** (dev/CI/default), the view shows the existing **"Open in Google Maps" deep-link** — no iframe, no key, fully functional.
- Going live is a **config change** (set the env var + restrict the key to the app's referrers in the Google console), never a code change.

## Consequences
- Zero-credential dev/CI keeps working; the interactive map lights up only where the client has provisioned + referrer-restricted a key.
- The Embed API shows one focused place per iframe (per-staff), which fits the "where is this driver" question. A single multi-pin map would need the Maps JavaScript API (a heavier script dependency) — deferred until there's a demonstrated need.
- No key is ever committed; it is a public (referrer-restricted) key by design, injected via env at build.
