# POS Guest In-Room QR Ordering + Kitchen Lifecycle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an in-house guest scan a per-room QR, self-order from the room-dining menu, and — after a one-tap staff accept — have it flow to the kitchen (with a status lifecycle + live display) and post to the room folio via the existing tested money path. No guest payment.

**Architecture:** Extends module 19 (POS). Phase 1 adds a `KitchenTicket` status lifecycle + live kitchen/inbox over the Module-17 SSE. Phase 2 adds a public (unauthenticated, token-gated, rate-limited) ordering surface that creates `PosOrder(status=REQUESTED)`; staff **accept** → reuse the existing `settleToFolio`, **reject** → VOID. The money path is unchanged — only a REQUESTED gate is added in front of it.

**Tech Stack:** Next.js 15 App Router, Prisma 6, TypeScript strict, zod, Vitest + Playwright, Module-17 SSE (`useRealtime`), new dep `qrcode` (ADR-0007).

## Global Constraints

- Spec: `specs/19-pos/` (FR-19–FR-26, AC-16–AC-22, T-21–T-30). Depth bar: existing 19 code.
- Money only via 06. POS writes **no** FolioLine/Payment/Invoice row. Guest accept reuses `settleToFolio` verbatim; the QR flow touches no money.
- Canonical write path for every staff mutation: `zod.parse → requireUser → authorize → withPosContext → $transaction → emitEvent → writeAudit → toResult`. Mirror `src/features/pos/settle-actions.ts`.
- Money = integer paise; GST via the shared `lib/tax` split (on-premise F&B → CGST+SGST, place-of-supply = property state). `FolioLine(type=FOOD)` = `POS_FOLIO_CHARGE_TYPE` (already the constant in `pos/internal.ts`).
- Property-scoped everywhere via `db.scoped(user)` / `posDb(user)`. Public route uses a dedicated guest context (no session, no PII).
- New event names must be added to `src/lib/events/catalog.ts` (compile-enforced union) AND `docs/architecture/domain-events.md`, and to the SSE `BROADCASTABLE` allow-list in `src/app/api/realtime/route.ts` if broadcast.
- TDD: domain unit tests first; action integration tests against the real DB (mock only `@/lib/auth` per `tests/integration/pos.test.ts`); e2e on the prod server (mobile viewport). Commit per task.

---

## File Structure

**Phase 1 (kitchen lifecycle):**
- Modify `prisma/schema.prisma` — `PosOrderStatus += REQUESTED`; `PosOrder += source, guestNote`; `PosOutlet += isRoomDining`; `Room += orderToken`; new `KitchenTicket` + `KitchenTicketStatus`. New migration.
- Create `src/features/pos/domain/kitchen-ticket.ts` — pure `canAdvanceTicket` state machine.
- Modify `src/features/pos/actions.ts` — `sendToKitchen` also creates a `KitchenTicket(QUEUED)`.
- Create `src/features/pos/kitchen-actions.ts` — `startTicket` / `readyTicket` / `serveTicket`.
- Modify `src/features/pos/queries.ts` — `kitchenTickets(propertyId)` (+ keep `kitchenPrep`).
- Modify `src/features/pos/events.ts` + `src/lib/events/catalog.ts` + `docs/architecture/domain-events.md` — `KitchenTicketMoved`.
- Modify `src/app/api/realtime/route.ts` — allow-list `KitchenTicketMoved`, `GuestOrderRequested`.
- Modify `src/features/pos/components/kitchen-screen.tsx` — per-ticket actions + `useRealtime`.

**Phase 2 (guest QR):**
- Modify `prisma` (folded into Phase-1 migration — `Room.orderToken`, `PosOutlet.isRoomDining` already there).
- Create `src/features/pos/guest-internal.ts` — `withGuestContext` + `resolveRoomToken` (token → room/property/outlet + occupied-gate).
- Create `src/features/pos/guest-actions.ts` — `submitGuestOrder` (public), `acceptGuestOrder`, `rejectGuestOrder` (staff).
- Create `src/features/pos/guest-queries.ts` — `getGuestMenu(token)`, `roomOrderInbox(propertyId)`.
- Create `src/app/(public)/order/[token]/page.tsx` + `guest-order-screen.tsx` — the public guest UI.
- Modify `src/middleware.ts` — allow `/order` public.
- Modify `src/features/pos/components/pos-screen.tsx` — Room-orders inbox section (Accept/Reject + `useRealtime`).
- Modify `src/features/rooms/…` + room detail page — `orderToken` generation + QR render (`qrcode`).
- Add `qrcode` to `package.json` (ADR-0007).

---

## Phase 1 — Kitchen ticket lifecycle + live display

### Task 1: Schema + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_pos_guest_qr_kitchen/migration.sql` (via `prisma migrate dev`)

**Interfaces — Produces:** `enum KitchenTicketStatus { QUEUED PREPARING READY SERVED }`; `model KitchenTicket { id, orderId @unique, propertyId, outletId, status, queuedAt, startedAt?, readyAt?, servedAt?, createdAt, updatedAt }`; `PosOrderStatus += REQUESTED`; `PosOrder += source PosOrderSource @default(STAFF), guestNote String?`; `enum PosOrderSource { STAFF GUEST_QR }`; `PosOutlet += isRoomDining Boolean @default(false)`; `Room += orderToken String? @unique`.

- [ ] **Step 1: Edit schema.** Add the enums/fields/model above. `KitchenTicket` indexes: `@@index([propertyId, status])`. `Room.orderToken` on the 02-owned `Room` model (documented comment: "19 reads via 02; stamped per-room QR secret").
- [ ] **Step 2: Generate migration.** Run: `npx prisma migrate dev --name pos_guest_qr_kitchen` (uses DIRECT_URL). Expected: migration created + applied, `prisma generate` runs.
- [ ] **Step 3: Verify in-DB.** Run a quick `node --env-file=.env` script: `KitchenTicketStatus` enum exists, `PosOrder.source` defaults `STAFF`. Expected: columns present.
- [ ] **Step 4: Commit.** `git add prisma/ && git commit -m "feat(19): schema — REQUESTED status, source, KitchenTicket, orderToken, isRoomDining (T-21)"`

### Task 2: KitchenTicket state machine (domain, test-first)

**Files:**
- Create: `src/features/pos/domain/kitchen-ticket.ts`
- Test: `tests/unit/pos/kitchen-ticket.test.ts`

**Interfaces — Produces:** `type TicketStatus = "QUEUED"|"PREPARING"|"READY"|"SERVED"`; `canAdvanceTicket(from: TicketStatus, to: TicketStatus): boolean`; `nextTicketStatus(from: TicketStatus): TicketStatus | null`.

- [ ] **Step 1: Write failing tests.**
```ts
import { describe, it, expect } from "vitest";
import { canAdvanceTicket, nextTicketStatus } from "@/features/pos/domain/kitchen-ticket";

describe("kitchen ticket state machine (FR-24)", () => {
  it("advances forward one step only", () => {
    expect(canAdvanceTicket("QUEUED", "PREPARING")).toBe(true);
    expect(canAdvanceTicket("PREPARING", "READY")).toBe(true);
    expect(canAdvanceTicket("READY", "SERVED")).toBe(true);
  });
  it("rejects skips and backward moves", () => {
    expect(canAdvanceTicket("QUEUED", "READY")).toBe(false);
    expect(canAdvanceTicket("READY", "QUEUED")).toBe(false);
    expect(canAdvanceTicket("SERVED", "READY")).toBe(false);
    expect(canAdvanceTicket("SERVED", "SERVED")).toBe(false);
  });
  it("nextTicketStatus returns the single successor or null at end", () => {
    expect(nextTicketStatus("QUEUED")).toBe("PREPARING");
    expect(nextTicketStatus("SERVED")).toBeNull();
  });
});
```
- [ ] **Step 2: Run — expect FAIL** (`npx vitest run tests/unit/pos/kitchen-ticket.test.ts`) — module not found.
- [ ] **Step 3: Implement.**
```ts
/** KitchenTicket state machine (19 FR-24). Forward-only, one step at a time. */
export type TicketStatus = "QUEUED" | "PREPARING" | "READY" | "SERVED";
const ORDER: TicketStatus[] = ["QUEUED", "PREPARING", "READY", "SERVED"];
export function nextTicketStatus(from: TicketStatus): TicketStatus | null {
  const i = ORDER.indexOf(from);
  return i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1]! : null;
}
export function canAdvanceTicket(from: TicketStatus, to: TicketStatus): boolean {
  return nextTicketStatus(from) === to;
}
```
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit.** `feat(19): kitchen ticket state machine (T-22)`

### Task 3: sendToKitchen creates a ticket + advance actions (integration)

**Files:**
- Modify: `src/features/pos/actions.ts` (`sendToKitchen` creates `KitchenTicket(QUEUED)`, idempotent on `orderId`)
- Create: `src/features/pos/kitchen-actions.ts` (`startTicket`/`readyTicket`/`serveTicket`)
- Modify: `src/features/pos/events.ts`, `src/lib/events/catalog.ts` (`KitchenTicketMoved`), `docs/architecture/domain-events.md`
- Modify: `src/features/pos/schema.ts` (`ticketActionSchema = z.object({ ticketId: z.string().min(1) })`)
- Test: `tests/integration/pos-kitchen.test.ts`

**Interfaces — Consumes:** `canAdvanceTicket`, `nextTicketStatus` (Task 2); `withPosContext`, `posDb` (`pos/internal.ts`). **Produces:** `startTicket/readyTicket/serveTicket(input): Promise<Result<{ status: TicketStatus }>>`; each authorizes `pos:order-create` on the ticket's property, advances via `canAdvanceTicket`, stamps the matching timestamp, emits `KitchenTicketMoved`, audits `pos:kitchen-advance`.

- [ ] **Step 1: Write failing integration tests** (mirror `tests/integration/pos.test.ts` harness — mock `@/lib/auth`, real DB, `actAs`). Cover: `sendToKitchen` on an OPEN order creates one `KitchenTicket(QUEUED)` (calling twice is idempotent); `startTicket→PREPARING` stamps `startedAt` + emits `KitchenTicketMoved`; illegal `serveTicket` on a QUEUED ticket → `ILLEGAL_TICKET_TRANSITION`; RBAC deny without `pos:order-create`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Add `KitchenTicketMoved` to catalog** (`{ ticketId, orderId, propertyId, status }` payload) + `docs/architecture/domain-events.md` row.
- [ ] **Step 4: Implement `sendToKitchen` ticket creation** — inside its existing tx, `tx.kitchenTicket.upsert({ where: { orderId }, create: { orderId, propertyId, outletId, status: "QUEUED", queuedAt: new Date() }, update: {} })`.
- [ ] **Step 5: Implement `kitchen-actions.ts`** — one shared helper `advance(input, to, stampField)` following the canonical path:
```ts
"use server";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { canAdvanceTicket, type TicketStatus } from "./domain/kitchen-ticket";
import { posDb, withPosContext } from "./internal";
import { ticketActionSchema } from "./schema";

async function advance(input: unknown, to: TicketStatus, stamp: "startedAt" | "readyAt" | "servedAt"): Promise<Result<{ status: TicketStatus }>> {
  return toResult(async () => {
    const { ticketId } = ticketActionSchema.parse(input);
    const user = await requireUser();
    const client = posDb(user);
    const t = await client.kitchenTicket.findFirst({ where: { id: ticketId }, select: { id: true, propertyId: true, orderId: true, status: true } });
    if (!t) throw new NotFoundError("Ticket not found.");
    authorize(user, "pos:order-create", t.propertyId);
    if (!canAdvanceTicket(t.status as TicketStatus, to)) throw new DomainError(ErrorCode.ILLEGAL_TICKET_TRANSITION);
    await withPosContext(user, () => client.$transaction(async (tx) => {
      await tx.kitchenTicket.updateMany({ where: { id: ticketId, status: t.status as never }, data: { status: to as never, [stamp]: new Date() } });
      await emitEvent(tx, { type: "KitchenTicketMoved", aggregateId: ticketId, propertyId: t.propertyId, payload: { ticketId, orderId: t.orderId, status: to } });
      await writeAudit(tx, { action: "pos:kitchen-advance", entityType: "KitchenTicket", entityId: ticketId, propertyId: t.propertyId, before: { status: t.status }, after: { status: to } });
    }));
    return { status: to };
  });
}
export const startTicket = (i: unknown) => advance(i, "PREPARING", "startedAt");
export const readyTicket = (i: unknown) => advance(i, "READY", "readyAt");
export const serveTicket = (i: unknown) => advance(i, "SERVED", "servedAt");
```
Add `ILLEGAL_TICKET_TRANSITION` to `src/lib/errors.ts` (code + 409 + user message).
- [ ] **Step 6: Run — expect PASS.**
- [ ] **Step 7: Commit.** `feat(19): KitchenTicket creation + advance actions (T-23)`

### Task 4: Kitchen screen actions + live

**Files:**
- Modify: `src/features/pos/queries.ts` (`kitchenTickets(user, propertyId)` → tickets not-SERVED, joined room/order code)
- Modify: `src/features/pos/components/kitchen-screen.tsx` (Start/Ready/Served buttons per ticket; `useRealtime`)
- Modify: `src/app/api/realtime/route.ts` (allow-list `KitchenTicketMoved`)

- [ ] **Step 1:** Add `KitchenTicketMoved` to `BROADCASTABLE`.
- [ ] **Step 2:** `kitchenTickets` query (property-scoped, status != SERVED, order by queuedAt).
- [ ] **Step 3:** Kitchen screen: render tickets with a single "Advance" button showing the next status (`nextTicketStatus`), calling the matching action; `useRealtime({ types: ["KitchenTicketMoved","GuestOrderRequested"] })`.
- [ ] **Step 4:** Typecheck + lint (`npx tsc --noEmit`, `npx eslint src/features/pos src/app/api/realtime`).
- [ ] **Step 5: Commit.** `feat(19): live kitchen screen with ticket advance (T-24)`

---

## Phase 2 — Guest in-room QR ordering

### Task 5: Room orderToken + QR on the room page

**Files:**
- Add dep: `npm i qrcode && npm i -D @types/qrcode` (ADR-0007)
- Modify: `src/features/rooms/…` — action to stamp `orderToken` (cuid) if null; helper `roomOrderUrl(token)`
- Modify: room detail page — render QR (server-side `QRCode.toDataURL(url)`) + printable + copyable link
- Test: `tests/integration/rooms-order-token.test.ts` (stamping is idempotent; token unique)

- [ ] **Step 1:** Write failing test — stamping a room without a token sets a unique `orderToken`; second call is a no-op (same token).
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement `ensureRoomOrderToken(roomId)` (authorized `room:manage`, audited) — `updateMany where orderToken null` set `cuid()`.
- [ ] **Step 4:** Room detail page: `const url = roomOrderUrl(room.orderToken); const qr = await QRCode.toDataURL(url)` → `<img>` + Print + Copy-link. (QR only encodes the public non-secret URL.)
- [ ] **Step 5:** Run — expect PASS; typecheck/lint.
- [ ] **Step 6: Commit.** `feat(19): per-room order token + printable QR (T-25)`

### Task 6: Public route + token resolution + occupied-gate

**Files:**
- Create: `src/features/pos/guest-internal.ts` (`resolveRoomToken`, `withGuestContext`)
- Create: `src/features/pos/guest-queries.ts` (`getGuestMenu(token)`)
- Create: `src/app/(public)/order/[token]/page.tsx`
- Modify: `src/middleware.ts` (add `/order` to PUBLIC_PREFIXES)
- Test: `tests/integration/pos-guest.test.ts` (gate cases)

**Interfaces — Produces:** `resolveRoomToken(token): Promise<{ propertyId, roomId, roomNumber, outletId, reservationId } | null>` — returns null unless the token matches a room, the room's property has a resolvable room-dining outlet, AND the room has an IN_HOUSE reservation (occupied-gate). `getGuestMenu(token): Promise<{ ok: false } | { ok: true, roomNumber, outletName, items: {id,name,ratePaise,gstBps}[] }>` — menu only, no PII.

- [ ] **Step 1: Write failing tests** — unknown token → null; occupied room + room-dining outlet → resolves; vacant room → null; property with multiple outlets none flagged → null (unavailable).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement `resolveRoomToken`** using `db.unscoped()` (public, no session) constrained by the token; outlet resolution rule from the spec (isRoomDining, else sole outlet, else none). Occupied = a Reservation `IN_HOUSE` for that room (via roomAllocation/current in-house).
- [ ] **Step 4: Implement `getGuestMenu`** + the `page.tsx` (server component): resolve → if null render "ordering unavailable"; else render `<GuestOrderScreen menu … token … />`. Add `/order` to middleware PUBLIC_PREFIXES.
- [ ] **Step 5: Run — expect PASS; verify `/order/<bad>` renders unavailable, no PII.**
- [ ] **Step 6: Commit.** `feat(19): public /order/[token] route + occupied-gated menu (T-26)`

### Task 7: submitGuestOrder (public action)

**Files:**
- Modify: `src/features/pos/guest-actions.ts` (`submitGuestOrder`)
- Modify: `src/features/pos/events.ts` + catalog (`GuestOrderRequested`)
- Modify: `src/features/pos/schema.ts` (`submitGuestOrderSchema = { token, lines: [{menuItemId, quantity}], note? }`)
- Test: extend `tests/integration/pos-guest.test.ts`

**Interfaces — Produces:** `submitGuestOrder(input): Promise<Result<{ orderId: string }>>` — public (no `requireUser`); resolves token (else `ROOM_NOT_AVAILABLE`), **server-prices** each line from `MenuItem` (ignores any client price), creates `PosOrder(status=REQUESTED, source=GUEST_QR, reservationId=<in-house>)` + items + `guestNote`, emits `GuestOrderRequested`, audits via `withGuestContext`. Rate-limited.

- [ ] **Step 1: Write failing tests** — submit to occupied room → `PosOrder(REQUESTED, GUEST_QR)` with server prices, `GuestOrderRequested` emitted, **no folio line, no kitchen ticket**; submit to vacant room → `ROOM_NOT_AVAILABLE`; client-sent price is ignored (amount = MenuItem.ratePaise × qty).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Add `GuestOrderRequested` to catalog** (`{ orderId, propertyId, roomNumber }`) + domain-events doc.
- [ ] **Step 4: Implement `submitGuestOrder`** (no `requireUser`; `withGuestContext` binds a `guest-qr` actor for audit; reuse the per-property `code` allocator from `internal.ts`). Apply the existing rate-limit util (as used by booking-engine — locate `src/lib/**` rate-limit; if none, a simple per-token throttle).
- [ ] **Step 5: Run — expect PASS.**
- [ ] **Step 6: Commit.** `feat(19): submitGuestOrder → REQUESTED (T-27)`

### Task 8: Room-orders inbox + accept/reject (money gate)

**Files:**
- Modify: `src/features/pos/guest-actions.ts` (`acceptGuestOrder`, `rejectGuestOrder`)
- Modify: `src/features/pos/guest-queries.ts` (`roomOrderInbox(propertyId)`)
- Modify: `src/features/pos/components/pos-screen.tsx` (inbox section + `useRealtime`)
- Modify: `src/app/api/realtime/route.ts` (`GuestOrderRequested` allow-listed — done in Task 4/here)
- Test: extend `tests/integration/pos-guest.test.ts`

**Interfaces — Consumes:** `settleToFolio` (existing), `sendToKitchen` (Task 3), `canTransition`. **Produces:** `acceptGuestOrder({orderId}): Promise<Result<{ folioId, lineId }>>` — authorizes `pos:order-create`; requires status REQUESTED (else `ORDER_NOT_REQUESTED`); transitions REQUESTED→OPEN (claim), calls `sendToKitchen` then `settleToFolio`; `rejectGuestOrder({orderId, reason}): Promise<Result<{ ok: true }>>` — `pos:order-void`, REQUESTED→VOID, audit, `PosOrderVoided`.

- [ ] **Step 1: Write failing tests** — accept a REQUESTED order → order OPEN→SETTLED, one `KitchenTicket(QUEUED)`, a `FolioLine(type=FOOD)` with correct CGST+SGST posted to the room's folio; reject → VOID + **no folio line**; accept on a non-REQUESTED order → `ORDER_NOT_REQUESTED`; RBAC: reject needs `pos:order-void`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement `acceptGuestOrder`** — claim REQUESTED→OPEN (mirror `claimTransition` in settle-actions), then `await sendToKitchen({orderId})`, then `return settleToFolio({orderId})` (reuses the tested money path verbatim). `rejectGuestOrder` — claim REQUESTED→VOID + emit `PosOrderVoided` + audit. Add `ORDER_NOT_REQUESTED` to errors.
- [ ] **Step 4:** `roomOrderInbox` query (REQUESTED orders, property-scoped) + inbox UI on the POS screen with Accept/Reject + `useRealtime({ types: ["GuestOrderRequested"] })`.
- [ ] **Step 5: Run — expect PASS; typecheck/lint.**
- [ ] **Step 6: Commit.** `feat(19): room-orders inbox accept→settleToFolio / reject→VOID (T-28)`

### Task 9: E2E — guest → accept → kitchen → folio; gate + reject; live

**Files:**
- Create: `tests/e2e/pos-guest-ordering.spec.ts`

- [ ] **Step 1:** Seed (beforeAll): a room with `orderToken`, an IN_HOUSE reservation + open folio, a room-dining outlet + menu.
- [ ] **Step 2:** Test A: visit `/order/<token>` (no auth) → menu shows → add item → submit → "sent" confirmation. Sign in as reception → POS Room-orders inbox shows it (live) → Accept → assert in-DB: order SETTLED, `KitchenTicket` exists, `FolioLine(type=FOOD)` on the room folio with CGST+SGST. Kitchen screen: advance QUEUED→SERVED.
- [ ] **Step 3:** Test B (gate): set room VACANT → `/order/<token>` shows unavailable, no submit.
- [ ] **Step 4:** Test C (reject): submit → staff Reject → order VOID, no folio line.
- [ ] **Step 5:** Run against the prod server (build once, `npm run start -- --port 3100`, reuse). Expected: green. Cleanup (afterAll).
- [ ] **Step 6: Commit.** `test(e2e): guest QR order → accept → kitchen → folio (T-29)`

### Task 10: Review + close

- [ ] **Step 1:** Full `npx tsc --noEmit` + `npx eslint .` green.
- [ ] **Step 2:** `feature-dev:code-reviewer` over the addendum diff; fix high-confidence findings (esp. the public endpoint: no PII leak, occupied-gate can't be bypassed, guest can't reach money/authed surfaces; accept path posts exactly one folio line under concurrency).
- [ ] **Step 3:** Check every new FR-19–26 / AC-16–22 maps to a green test; tick `specs/19-pos/tasks.md` T-21–T-30.
- [ ] **Step 4: Commit.** `docs(19): tick addendum tasks; review clean (T-30)`

---

## Self-Review

- **Spec coverage:** FR-19→T5; FR-20→T6; FR-21→T7; FR-22→T8; FR-23→T8; FR-24→T2/T3; FR-25→T4/T8; FR-26→T6/T7. AC-16–22 covered by T5/T6/T7/T8/T9. ✓
- **Placeholder scan:** rate-limit util is "locate existing / simple per-token throttle" — the one deliberately-open item (booking-engine's util to be confirmed at T7); everything else is concrete. Occupied-gate "current in-house reservation" resolution to be matched to how 06/03 resolve a room's in-house reservation at T6.
- **Type consistency:** `TicketStatus` used consistently (Tasks 2–4); `acceptGuestOrder` returns the same `{folioId,lineId}` as `settleToFolio` it delegates to; `POS_FOLIO_CHARGE_TYPE`/`FOOD` reused, not redefined.
