# /review-module — 01-property-management

**Date:** 2026-07-22 · **Reviewer:** implementing engineer (self-review, per DoD § Review)
**Depends on:** 00-platform ✅ ([review](00-platform-review.md))

Checklist source: [`.claude/commands/review-module.md`](../../.claude/commands/review-module.md)

---

## 1. Traceability — every AC → a passing test

All **10** acceptance criteria in
[`specs/01-property-management/user-stories.md`](../../specs/01-property-management/user-stories.md)
map to at least one named test.

| AC | Requirement | Covered by |
|---|---|---|
| AC-1 | Create property → saved, listed, `PropertyCreated` + audit | `properties` (integration) · e2e journey |
| AC-2 | Duplicate `code` rejected | `properties` (incl. concurrent race) · e2e |
| AC-3 | Valid GSTIN accepted, invalid rejected with a field error | `gstin` (16 unit) · `properties` · e2e |
| AC-4 | Floors persist ordered; duplicate rejected | `properties` · e2e journey |
| AC-5 | Deactivation hides from operations, keeps history | `properties` |
| AC-6 | Overview counts + **33%** live occupancy | `occupancy` (14 unit) · `properties` · e2e |
| AC-7 | Room status change → tile updates < 2s | `occupancy` (44% after check-in) · `properties` |
| AC-8 | Scoped Manager sees only PROP-A | `properties` · e2e |
| AC-9 | Manager denied property creation (403) | `properties` · **e2e (real HTTP 403)** |
| AC-10 | Missing required fields rejected, nothing persists | `properties` · e2e |

---

## 2. Invariants

| Invariant | Status |
|---|---|
| Money in paise | **N/A** — 01 owns no money path |
| Occupancy definition | ✅ **(b) live status rollup**, not (a) room-night. `RESERVED` is *not* occupied; `UNDER_MAINTENANCE` leaves the **denominator**. Basis points (integer), never a float |
| Occupancy labelling | ✅ tile reads "current-status occupancy" — `reporting.md` requires the label, and an e2e test asserts it |
| Soft delete retains history | ✅ `isActive=false` + `deletedAt`; row never removed; `includeInactive` opt-in for reports |
| Property code feeds invoice numbering | ✅ uppercase alphanumeric, ≤8 chars, unique per org |

---

## 3. Security

- ✅ Every mutation: zod → `authorize` → transaction → event + audit → `Result`.
- ✅ **Creation requires org-wide scope** — see Decision D-1.
- ✅ Editing is scoped to the target property: a Manager may edit theirs, not another's.
- ✅ Queries take claims explicitly and filter by `accessiblePropertyIds`;
  `getProperty`/`listFloors` call `assertPropertyInScope` **before** reading (00 FR-9).
- ✅ `/api/realtime` filters per event against the subscriber's scope and sends **no payload** —
  only type + aggregate id, so the client re-fetches through its own authorized query.
- ✅ GSTIN validated with its **check digit**, not merely its shape — see Decision D-2.

---

## 4. NFRs

- ✅ Overview is **one grouped count** over the `Room(propertyId, status)` index, not a per-room
  fetch — a 1000-room property costs the same as a 10-room one (design.md § Edge cases).
- ✅ Mobile-first: tiles stack on a phone, 44px targets, e2e on Pixel 7.
- ✅ Accessibility: the occupancy bar is a `role="meter"` with a full `aria-label`; required-field
  asterisks are outside the `<Label>` so the accessible name stays clean (finding F-3).
- ⚠️ **Latency budgets still unmeasured** — carried risk R-1 from 00 is unchanged.

---

## 5. Architecture

- ✅ Domain (`gstin`, `occupancy`) is pure — no I/O, no framework imports.
- ✅ Queries take claims rather than resolving a session (layering; also keeps the query layer
  testable without the Auth.js import chain).
- ✅ All `features/properties/*` files ≤ 300 lines after splitting actions by entity.
- ✅ No new dependency.
- ✅ No upward tier dependency — see Decision D-3.

---

## 6. Data

- ✅ `Property`/`Floor` slice, `@@unique([orgId, code])`, `@@unique([propertyId, name])` and
  `Room(propertyId, status)` all confirmed present from the baseline migration; **no new
  migration needed**.
- ✅ Seed extended with floors, categories and ROOMS-A; verified in-database to roll up to the
  **33%** AC-6 states.
- ✅ Seed exports `resetRoomsA()` so tests that mutate room status can restore the fixture
  (finding F-1).

---

## Decisions

### D-1 · Creating a property requires org-wide scope
`rbac-matrix.md` grants MANAGER `property:manage` (🔒); AC-9 requires a Manager to be **denied**
property creation. Reconciled via the matrix's own note — *"Managers act only within assigned
properties"* — since a property that does not exist yet is inside nobody's assignment. Enforced
as a **scope** check, not a role-name check, because `user-roles.md` is explicit that the app
checks permissions and scope rather than role names. A Manager may still edit their own property.

### D-2 · GSTIN validation includes the check digit — and two spec fixtures were wrong
`design.md` asks for checksum validation, but AC-3's own "valid" example `29ABCDE1234F1Z5` fails
it (real check digit `W`), as did both seeded property GSTINs. Implementing the spec as written
would have made AC-3 fail on its own example. Resolved in favour of correctness — a GSTIN lands
on a statutory GST invoice, and the common failure is someone typing it from memory. AC-3 now
uses `29ABCDE1234F1ZW` and **reuses the old value as the wrong-checksum negative case**, which is
a stronger test than it had. Edit annotated in place.

### D-3 · The realtime channel is platform infrastructure, not a 17 dependency
T-12 needs SSE, but the channel is described in spec **17-mobile-experience** (Tier 5) while 01 is
Tier 1 — and `architecture.md` forbids depending upward. Resolved by placing the substrate where
the other documents already put it: `tech-stack.md` lists realtime under **Platform services** and
`api-surface.md` defines `/api/realtime` in the core API. 17 will swap the poll for
`LISTEN/NOTIFY` and add reconnect/offline-queue **without changing the consumer surface**.

---

## Findings

### F-1 · Fixed · A 00 test silently corrupted 01's fixtures
`db-scoped.test.ts` deliberately issues `updateMany` with **no** where clause to prove the scope
filter works — which rewrote all 10 of ROOMS-A. Its cleanup restored only its own two rooms,
because ROOMS-A did not exist when it was written. 01's occupancy assertions caught it because
they are exact. **Fixed:** the seed owns `resetRoomsA()`, and the 00 test calls it.
**Lesson:** a test that mutates shared state must restore *everything it could have touched*, not
just what it created.

### F-2 · Fixed · The realtime route exhausted the connection pool
The first `/api/realtime` polled `DomainEvent` **per connection**, once a second. Fine with one
tab; under the e2e suite it produced *"Timed out fetching a new connection from the connection
pool"* and **sign-in itself began to fail**. Polling cost was O(N) in connected staff — a hotel
with eight people on the room board would have degraded the whole app. **Fixed:** one
process-wide poller ([`lib/events/broker.ts`](../../src/lib/events/broker.ts)) fanning out to all
subscribers, starting on the first and stopping on the last. Also raised `connection_limit` off
`1`, which is the *serverless* recommendation and wrong for a long-running Node server.

### F-3 · Fixed · Required-field asterisk polluted the accessible name
The asterisk rendered **inside** `<Label>`, making the field's accessible name `"Code*"` — a
screen reader announces "Code asterisk", and it also made "Code" ambiguous against "PIN code".
`aria-hidden` on the child span is **not** sufficient: the text still belongs to the label
element. **Fixed** by moving the asterisk outside `<Label>`. `mobile-first.md` requires WCAG AA,
so this was a real defect. Surfaced only because a Playwright selector could not match the label.

### F-4 · Fixed · Specific error messages were being discarded
`DomainError.userMessage` always returned the GENERIC text for its code, so
`ConflictError('Code "WMG" is already in use.')` reached the user as *"That change
conflicts with the current state."* — which AC-2 forbids and which leaves the user no way to fix
their input. The fix had to respect a requirement pulling the other way: FR-4's anti-enumeration
rule depends on every auth failure reading **identically**. Specificity is therefore **opt-in**
(`publicMessage`), and only `ConflictError` opts in — a conflict describes data the caller just
submitted, so it reveals nothing new. Auth errors keep the fixed text, and a plain `message`
argument still never reaches a client. Locked in by
[`tests/unit/errors.test.ts`](../../tests/unit/errors.test.ts), including *"gives a locked account
the SAME text as a wrong password"*.

### F-5 · Fixed · The e2e suite polluted the shared org
The T-16 journey creates real properties through the UI and did not remove them. Eight
accumulated, breaking three assertions elsewhere that state the org contains exactly PROP-A and
PROP-B. **Two fixes, because there were two faults:** the suite now has an `afterAll` that deletes
what it created, *and* those assertions were rewritten to express their real intent — "the
fixtures exist" and "an admin sees **the org's** properties", compared against the org rather
than a hardcoded pair. Either alone would have left the suite brittle.

### F-6 · Fixed · A dispatch test assumed an empty outbox
`dispatchOutbox` fetches the OLDEST undispatched events up to its batch cap of 100. No worker runs
during tests, so sign-ins and property creates leave a backlog — and a freshly emitted event sat
behind 100 older ones and never appeared in the batch under test. Correct dispatch behaviour,
wrong test assumption. The dispatch suite now drains the outbox first (stamping `dispatchedAt`,
the one mutation the append-only trigger permits).

### F-7 · Non-blocking · `reorderFloors` has no UI
The action and its authorization exist and are tested, but T-15's floors UI lists floors without
drag-to-reorder. Ordering is settable at creation time. **Action:** add when a property with many
floors makes it worth the interaction cost, or fold into 02's room board.

### F-8 · Non-blocking · `deactivateProperty` has no UI
Action, in-house guard and audit exist and are tested (AC-5), but there is no button. Deactivating
a property is rare and destructive; it belongs with the settings surfaces in **16**.

---

## Carried risks (unchanged from 00)

- **R-1** NFR latency budgets are **not measured** in a representative environment.
- **R-2** ≥90% domain coverage is configured but not enforced — no CI pipeline yet.
