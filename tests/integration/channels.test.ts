/**
 * 13 booking-channel-integrations integration — T-8..T-19. The crux guarantees:
 * connect/map + RBAC, activate cert-gate, inbound create-via-03 + dedupe,
 * missing-mapping dead-letter, modify/cancel, ChannelReservationPulled + ack,
 * outbound push (availability + DynamicRateApproved) in sandbox, oversell →
 * NEEDS_ATTENTION + alert + event + re-push, retry → dead-letter, invalid
 * signature → no side effects, and ONE availability truth (OTA + direct can't
 * overbook the same room). Traceability in each describe title.
 *
 * Auth mocked at the boundary (as in reservations.test.ts). Everything else is
 * real against the test DB. Dates are in 2029 so the past-date rule never trips
 * and ranges don't collide with other suites. Own rows use unique ids; cleaned
 * in afterAll.
 */
import { vi } from "vitest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { createPrismaClient } from "@/lib/db/client";
import type { SessionClaims } from "@/lib/auth/claims";

const authMock = vi.hoisted(() => ({ current: null as SessionClaims | null }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => {
    if (!authMock.current) throw new Error("no test user set");
    return authMock.current;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import {
  PROP_A_ID,
  CAT_DLX_ID,
  ROOM_101_ID,
  GUEST_RAVI_ID,
  USER_ADMIN_ID,
  USER_MANAGER_ID,
  USER_RECEPTION_A_ID,
} from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { setAlertTransport, resetAlertTransport, type Alert } from "@/lib/alerts";
import {
  connectChannel,
  mapRoomType,
  certifyChannel,
  activateChannel,
  resolveAttention,
} from "@/features/channels/actions";
import { channelHealth, needsAttentionQueue } from "@/features/channels/queries";
import { processInboundReservation } from "@/features/channels/inbound";
import { handleChannelEvent } from "@/features/channels/consumer";
import { pushDeltaToChannels, deadLetterStalePushes } from "@/features/channels/outbound";
import { handleChannelWebhook } from "@/features/channels/webhook";
import { createReservation } from "@/features/reservations/actions";

const prisma = createPrismaClient();

const PROVIDER_BDC = "booking_com";
const PROVIDER_LIVE = "test13_live";
const PROVIDER_CONNECT = "test13_connect";
const TEST_PHONE = "9900112233";

let ingestAccountId = "";
let liveAccountId = "";
const createdReservationIds: string[] = [];
const createdBlockIds: string[] = [];
const alerts: Alert[] = [];

async function actAs(userId: string): Promise<SessionClaims> {
  const claims = await assembleClaims(prisma, userId);
  if (!claims) throw new Error(`no claims for ${userId}`);
  authMock.current = claims;
  return claims;
}

/** Distinct future range so the exclusion constraint never collides across tests. */
function range(offsetDays: number, nights = 2): { checkIn: string; checkOut: string } {
  const base = Date.UTC(2029, 0, 1) + offsetDays * 86_400_000;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { checkIn: iso(base), checkOut: iso(base + nights * 86_400_000) };
}

function inboxRow(input: { provider: string; externalId: string; type: string; payload: Record<string, unknown> }) {
  return {
    id: `inbox_${input.externalId}`,
    provider: input.provider,
    externalId: input.externalId,
    type: input.type,
    payload: input.payload,
    processedAt: null,
    createdAt: new Date(),
  } as Parameters<typeof processInboundReservation>[1];
}

function newPayload(externalId: string, roomType: string, r: { checkIn: string; checkOut: string }) {
  return {
    provider: PROVIDER_BDC,
    propertyId: PROP_A_ID,
    externalId,
    type: "reservation.new",
    roomType,
    ratePlan: "BB",
    guest: { name: "Otto Aggregator", phone: TEST_PHONE, email: "otto@example.com" },
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    adults: 2,
    children: 0,
    amounts: { rate: 4000, tax: 480 },
  };
}

beforeAll(async () => {
  setAlertTransport({ name: "test", async send(a) { alerts.push(a); } });

  // Ingest account: booking_com @ PROP-A, sandbox, mapped DLX-BB → CAT-DLX.
  const ingest = await prisma.channelAccount.upsert({
    where: { propertyId_provider: { propertyId: PROP_A_ID, provider: PROVIDER_BDC } },
    create: { propertyId: PROP_A_ID, provider: PROVIDER_BDC, isActive: false, config: {} },
    update: { isActive: false },
    select: { id: true },
  });
  ingestAccountId = ingest.id;
  await prisma.roomTypeMapping.upsert({
    where: { channelAccountId_externalRoomType: { channelAccountId: ingestAccountId, externalRoomType: "DLX-BB" } },
    create: { channelAccountId: ingestAccountId, roomCategoryId: CAT_DLX_ID, externalRoomType: "DLX-BB", externalRatePlan: "BB" },
    update: { roomCategoryId: CAT_DLX_ID },
  });

  // Live-but-not-wired account for the failing-push / dead-letter test. Kept
  // INACTIVE by default so it is not a push target during the sandbox tests;
  // T-17 activates it just-in-time to force a failing push.
  const live = await prisma.channelAccount.upsert({
    where: { propertyId_provider: { propertyId: PROP_A_ID, provider: PROVIDER_LIVE } },
    create: { propertyId: PROP_A_ID, provider: PROVIDER_LIVE, isActive: false, certifiedAt: new Date(), credentialsRef: "vault://test", config: {} },
    update: { isActive: false, certifiedAt: new Date(), credentialsRef: "vault://test" },
    select: { id: true },
  });
  liveAccountId = live.id;
  await prisma.roomTypeMapping.upsert({
    where: { channelAccountId_externalRoomType: { channelAccountId: liveAccountId, externalRoomType: "DLX-LIVE" } },
    create: { channelAccountId: liveAccountId, roomCategoryId: CAT_DLX_ID, externalRoomType: "DLX-LIVE" },
    update: { roomCategoryId: CAT_DLX_ID },
  });
});

beforeEach(() => {
  authMock.current = null;
  alerts.length = 0;
});

afterEach(async () => {
  if (createdReservationIds.length) {
    await prisma.folio.deleteMany({ where: { reservationId: { in: createdReservationIds } } });
    await prisma.roomAllocation.deleteMany({ where: { reservationId: { in: createdReservationIds } } });
    await prisma.reservation.deleteMany({ where: { id: { in: createdReservationIds } } });
    createdReservationIds.length = 0;
  }
  if (createdBlockIds.length) {
    await prisma.roomBlock.deleteMany({ where: { id: { in: createdBlockIds } } });
    createdBlockIds.length = 0;
  }
});

afterAll(async () => {
  const accountIds = [ingestAccountId, liveAccountId].filter(Boolean);
  await prisma.channelSyncLog.deleteMany({ where: { channelAccountId: { in: accountIds } } });
  await prisma.roomTypeMapping.deleteMany({ where: { channelAccountId: { in: accountIds } } });
  await prisma.channelAccount.deleteMany({ where: { propertyId: PROP_A_ID, provider: { in: [PROVIDER_LIVE, PROVIDER_CONNECT] } } });
  await prisma.reservation.deleteMany({ where: { propertyId: PROP_A_ID, channelRef: { startsWith: "BDC13-" } } });
  resetAlertTransport();
  await prisma.$disconnect();
});

// Track any reservation created for a channelRef so cleanup can find it.
async function trackByChannelRef(channelRef: string): Promise<string | null> {
  const r = await prisma.reservation.findFirst({ where: { propertyId: PROP_A_ID, channelRef }, select: { id: true } });
  if (r) createdReservationIds.push(r.id);
  return r?.id ?? null;
}

// ---------------------------------------------------------------------------

describe("connect + map + RBAC (T-8, FR-1/4/16, AC-1/2/16)", () => {
  afterEach(async () => {
    await prisma.roomTypeMapping.deleteMany({ where: { channelAccount: { provider: PROVIDER_CONNECT } } });
    await prisma.channelAccount.deleteMany({ where: { propertyId: PROP_A_ID, provider: PROVIDER_CONNECT } });
  });

  it("admin connects a sandbox/inactive channel and maps a room type (AC-1/2)", async () => {
    await actAs(USER_ADMIN_ID);
    const conn = await connectChannel({ propertyId: PROP_A_ID, provider: PROVIDER_CONNECT });
    expect(conn.ok).toBe(true);
    if (!conn.ok) return;
    expect(conn.data.isActive).toBe(false);
    expect(conn.data.certified).toBe(false);

    const map = await mapRoomType({ channelAccountId: conn.data.id, roomCategoryId: CAT_DLX_ID, externalRoomType: "DLX-BB" });
    expect(map.ok).toBe(true);
    const persisted = await prisma.roomTypeMapping.findFirst({ where: { channelAccountId: conn.data.id, externalRoomType: "DLX-BB" } });
    expect(persisted?.roomCategoryId).toBe(CAT_DLX_ID);
  });

  it("reception (no integration:manage) is FORBIDDEN to connect (AC-16)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const conn = await connectChannel({ propertyId: PROP_A_ID, provider: PROVIDER_CONNECT });
    expect(conn.ok).toBe(false);
    if (!conn.ok) expect(conn.error.code).toBe("FORBIDDEN");
  });
});

describe("activate cert gate (T-9, FR-17, AC-3)", () => {
  it("refuses activation without certification, allows it after certify", async () => {
    await actAs(USER_ADMIN_ID);
    // ingest account starts uncertified.
    const denied = await activateChannel({ channelAccountId: ingestAccountId });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe("CHANNEL_NOT_CERTIFIED");
    const still = await prisma.channelAccount.findUniqueOrThrow({ where: { id: ingestAccountId } });
    expect(still.isActive).toBe(false);

    const cert = await certifyChannel({ channelAccountId: ingestAccountId, credentialsRef: "vault://bdc" });
    expect(cert.ok).toBe(true);
    const live = await activateChannel({ channelAccountId: ingestAccountId });
    expect(live.ok).toBe(true);

    // Reset to sandbox so downstream inbound tests exercise the mock adapter.
    await prisma.channelAccount.updateMany({ where: { id: ingestAccountId }, data: { isActive: false, certifiedAt: null, credentialsRef: null } });
  });
});

describe("inbound create via 03 + ack + dedupe (T-10/T-11/T-14, FR-5/6/15, AC-4/5/8)", () => {
  it("creates a reservation via 03 with source + channelRef, emits ChannelReservationPulled, acks, logs OK (AC-4/8)", async () => {
    const r = range(10);
    const channelRef = `BDC13-${Date.now()}-a`;
    const out = await processInboundReservation(prisma, inboxRow({ provider: PROVIDER_BDC, externalId: channelRef, type: "reservation.new", payload: newPayload(channelRef, "DLX-BB", r) }));
    expect(out.outcome).toBe("CREATED");
    const id = await trackByChannelRef(channelRef);
    expect(id).toBe(out.reservationId);

    const res = await prisma.reservation.findUniqueOrThrow({ where: { id: out.reservationId! } });
    expect(res.source).toBe("BOOKING_COM"); // provider→source mapping
    expect(res.channelRef).toBe(channelRef);
    expect(await prisma.roomAllocation.count({ where: { reservationId: res.id } })).toBe(1); // same availability as direct

    const pulled = await prisma.domainEvent.findFirst({ where: { type: "ChannelReservationPulled", aggregateId: res.id } });
    expect(pulled).not.toBeNull();
    const log = await prisma.channelSyncLog.findFirst({ where: { channelAccountId: ingestAccountId, direction: "IN", externalId: channelRef } });
    expect(log?.status).toBe("OK");
    const acct = await prisma.channelAccount.findUniqueOrThrow({ where: { id: ingestAccountId } });
    expect(acct.lastSyncAt).not.toBeNull();
  });

  it("dedupes a re-delivery — no duplicate reservation (AC-5)", async () => {
    const r = range(14);
    const channelRef = `BDC13-${Date.now()}-dupe`;
    const row = inboxRow({ provider: PROVIDER_BDC, externalId: channelRef, type: "reservation.new", payload: newPayload(channelRef, "DLX-BB", r) });
    await processInboundReservation(prisma, row);
    await processInboundReservation(prisma, row); // re-delivery
    await trackByChannelRef(channelRef);
    const count = await prisma.reservation.count({ where: { propertyId: PROP_A_ID, channelRef } });
    expect(count).toBe(1);
  });

  it("dedupes at the inbox layer via the webhook (AC-5)", async () => {
    const r = range(16);
    const channelRef = `BDC13-${Date.now()}-wh`;
    const body = JSON.stringify(newPayload(channelRef, "DLX-BB", r));
    const first = await handleChannelWebhook({ provider: PROVIDER_BDC, rawBody: body, signature: "" });
    const second = await handleChannelWebhook({ provider: PROVIDER_BDC, rawBody: body, signature: "" });
    expect(first.status).toBe("ACCEPTED");
    expect(second.status).toBe("DUPLICATE");
    const inbox = await prisma.integrationInbox.count({ where: { provider: PROVIDER_BDC, externalId: channelRef } });
    expect(inbox).toBe(1);
    await prisma.integrationInbox.deleteMany({ where: { provider: PROVIDER_BDC, externalId: channelRef } });
  });
});

describe("missing mapping → dead-letter (T-12, FR-7, AC-6)", () => {
  it("does NOT create a reservation; dead-letters + alerts", async () => {
    const r = range(20);
    const channelRef = `BDC13-${Date.now()}-nomap`;
    const out = await processInboundReservation(prisma, inboxRow({ provider: PROVIDER_BDC, externalId: channelRef, type: "reservation.new", payload: newPayload(channelRef, "SUPER-DELUXE", r) }));
    expect(out.outcome).toBe("DEAD_LETTER_MAPPING_MISSING");
    expect(out.reservationId).toBeNull();
    expect(await prisma.reservation.count({ where: { propertyId: PROP_A_ID, channelRef } })).toBe(0);
    const log = await prisma.channelSyncLog.findFirst({ where: { channelAccountId: ingestAccountId, externalId: channelRef } });
    expect(log?.status).toBe("DEAD_LETTER");
    expect(alerts.some((a) => a.title.toLowerCase().includes("unmapped"))).toBe(true);
  });
});

describe("inbound modify + cancel via 03 (T-13, FR-8, AC-7)", () => {
  it("applies a modify (new dates) then a cancel (releases inventory)", async () => {
    const r = range(24);
    const channelRef = `BDC13-${Date.now()}-mc`;
    const created = await processInboundReservation(prisma, inboxRow({ provider: PROVIDER_BDC, externalId: channelRef, type: "reservation.new", payload: newPayload(channelRef, "DLX-BB", r) }));
    const id = created.reservationId!;
    createdReservationIds.push(id);

    const r2 = range(26);
    const mod = await processInboundReservation(prisma, inboxRow({ provider: PROVIDER_BDC, externalId: channelRef, type: "reservation.modify", payload: newPayload(channelRef, "DLX-BB", r2) }));
    expect(mod.outcome).toBe("MODIFIED");
    const afterMod = await prisma.reservation.findUniqueOrThrow({ where: { id } });
    expect(afterMod.checkInDate.toISOString().slice(0, 10)).toBe(r2.checkIn);

    const can = await processInboundReservation(prisma, inboxRow({ provider: PROVIDER_BDC, externalId: channelRef, type: "reservation.cancel", payload: newPayload(channelRef, "DLX-BB", r2) }));
    expect(can.outcome).toBe("CANCELLED");
    const afterCancel = await prisma.reservation.findUniqueOrThrow({ where: { id } });
    expect(afterCancel.status).toBe("CANCELLED");
    expect(await prisma.roomAllocation.count({ where: { reservationId: id } })).toBe(0); // inventory released
    const cancelled = await prisma.domainEvent.findFirst({ where: { type: "ReservationCancelled", aggregateId: id } });
    expect(cancelled).not.toBeNull();
  });

  it("dead-letters a modify/cancel for an unknown channelRef (edge case)", async () => {
    const r = range(28);
    const out = await processInboundReservation(prisma, inboxRow({ provider: PROVIDER_BDC, externalId: "BDC13-unknown-ref", type: "reservation.cancel", payload: newPayload("BDC13-unknown-ref", "DLX-BB", r) }));
    expect(out.outcome).toContain("DEAD_LETTER_UNKNOWN_REF");
    expect(alerts.length).toBeGreaterThan(0);
  });
});

describe("outbound push in sandbox (T-15, FR-9/10/18, AC-9/10/11)", () => {
  it("pushes availability to the sandbox outbox on an availability event (AC-9/11)", async () => {
    // Make the ingest account active-sandbox so it is a push target.
    await prisma.channelAccount.updateMany({ where: { id: ingestAccountId }, data: { isActive: true } });
    const r = range(40);
    const out = await pushDeltaToChannels(prisma, "org_woodpecker", {
      push: "availability", propertyId: PROP_A_ID, categoryId: CAT_DLX_ID,
      from: new Date(`${r.checkIn}T00:00:00.000Z`), to: new Date(`${r.checkOut}T00:00:00.000Z`), ratePaise: null,
    });
    expect(out.pushed).toBeGreaterThanOrEqual(1);
    const log = await prisma.channelSyncLog.findFirst({ where: { channelAccountId: ingestAccountId, direction: "OUT", type: "pushAvailability" }, orderBy: { createdAt: "desc" } });
    expect(log?.status).toBe("OK");
    const pushed = await prisma.domainEvent.findFirst({ where: { type: "ChannelPushed", aggregateId: ingestAccountId }, orderBy: { seq: "desc" } });
    expect(pushed).not.toBeNull();
    await prisma.channelAccount.updateMany({ where: { id: ingestAccountId }, data: { isActive: false } });
  });

  it("pushes rates on a DynamicRateApproved event (AC-10)", async () => {
    await prisma.channelAccount.updateMany({ where: { id: ingestAccountId }, data: { isActive: true } });
    const r = range(44);
    await handleChannelEvent(prisma, {
      id: `evt_${Date.now()}`, seq: 1n, type: "DynamicRateApproved", orgId: "org_woodpecker", propertyId: PROP_A_ID,
      aggregateId: "dyn_1", occurredAt: new Date(),
      payload: { propertyId: PROP_A_ID, categoryId: CAT_DLX_ID, from: r.checkIn, to: r.checkOut, ratePaise: 450_000 },
    });
    const log = await prisma.channelSyncLog.findFirst({ where: { channelAccountId: ingestAccountId, direction: "OUT", type: "pushRates" }, orderBy: { createdAt: "desc" } });
    expect(log?.status).toBe("OK");
    await prisma.channelAccount.updateMany({ where: { id: ingestAccountId }, data: { isActive: false } });
  });
});

describe("oversell → needs-attention + alert + event + re-push (T-16, FR-12, AC-12)", () => {
  it("ingests an oversell unallocated, queues NEEDS_ATTENTION, alerts, emits, never drops", async () => {
    await prisma.channelAccount.updateMany({ where: { id: ingestAccountId }, data: { isActive: true } });
    const r = range(60);
    const from = new Date(`${r.checkIn}T00:00:00.000Z`);
    const to = new Date(`${r.checkOut}T00:00:00.000Z`);

    // Block every Deluxe room for the range so no room is free (forces oversell).
    const deluxe = await prisma.room.findMany({ where: { propertyId: PROP_A_ID, categoryId: CAT_DLX_ID }, select: { id: true } });
    for (const room of deluxe) {
      const block = await prisma.roomBlock.create({ data: { propertyId: PROP_A_ID, roomId: room.id, startDate: from, endDate: to, reason: "test13-oversell" }, select: { id: true } });
      createdBlockIds.push(block.id);
    }

    const channelRef = `BDC13-${Date.now()}-os`;
    const out = await processInboundReservation(prisma, inboxRow({ provider: PROVIDER_BDC, externalId: channelRef, type: "reservation.new", payload: newPayload(channelRef, "DLX-BB", r) }));
    const id = out.reservationId!;
    createdReservationIds.push(id);

    expect(out.outcome).toBe("CREATED_OVERSELL");
    const res = await prisma.reservation.findUniqueOrThrow({ where: { id } });
    expect(res.needsAttention).toBe("OVERSELL");
    expect(await prisma.roomAllocation.count({ where: { reservationId: id } })).toBe(0); // never dropped, unallocated

    const attn = await prisma.channelSyncLog.findFirst({ where: { channelAccountId: ingestAccountId, direction: "IN", externalId: channelRef, status: "NEEDS_ATTENTION" } });
    expect(attn).not.toBeNull();
    expect(alerts.some((a) => a.code === "CHANNEL_OVERSELL")).toBe(true);
    const event = await prisma.domainEvent.findFirst({ where: { type: "ChannelOversellDetected", aggregateId: id } });
    expect(event).not.toBeNull();

    // It shows up in the needs-attention queue for reception.
    await actAs(USER_MANAGER_ID);
    const queue = await needsAttentionQueue(authMock.current!, PROP_A_ID);
    expect(queue.some((q) => q.externalId === channelRef)).toBe(true);

    // Resolving it clears the queue (design § needs-attention persistence).
    await actAs(USER_ADMIN_ID);
    const resolved = await resolveAttention({ syncLogId: attn!.id });
    expect(resolved.ok).toBe(true);
    const after = await prisma.channelSyncLog.findUniqueOrThrow({ where: { id: attn!.id } });
    expect(after.status).toBe("OK");

    await prisma.channelAccount.updateMany({ where: { id: ingestAccountId }, data: { isActive: false } });
  });
});

describe("retry → dead-letter; front desk unblocked (T-17, FR-13, AC-13)", () => {
  it("a failing push becomes FAILED, then DEAD_LETTER past the window, with an admin alert", async () => {
    const r = range(80);
    // Activate the live (not-wired) account so it becomes a push target and its
    // adapter returns ok:false → FAILED row. Ingest stays inactive here.
    await prisma.channelAccount.updateMany({ where: { id: ingestAccountId }, data: { isActive: false } });
    await prisma.channelAccount.updateMany({ where: { id: liveAccountId }, data: { isActive: true } });
    const out = await pushDeltaToChannels(prisma, "org_woodpecker", {
      push: "availability", propertyId: PROP_A_ID, categoryId: CAT_DLX_ID,
      from: new Date(`${r.checkIn}T00:00:00.000Z`), to: new Date(`${r.checkOut}T00:00:00.000Z`), ratePaise: null,
    });
    expect(out.failed).toBeGreaterThanOrEqual(1);
    const failed = await prisma.channelSyncLog.findFirst({ where: { channelAccountId: liveAccountId, direction: "OUT", status: "FAILED" }, orderBy: { createdAt: "desc" } });
    expect(failed).not.toBeNull();

    // Age it out → dead-letter + alert.
    const future = new Date(Date.now() + 60 * 60_000);
    const dl = await deadLetterStalePushes(prisma, future);
    expect(dl.deadLettered).toBeGreaterThanOrEqual(1);
    const deadRow = await prisma.channelSyncLog.findFirst({ where: { channelAccountId: liveAccountId, direction: "OUT", status: "DEAD_LETTER" } });
    expect(deadRow).not.toBeNull();
    expect(alerts.some((a) => a.code === "channel.dead_letter")).toBe(true);

    // Front desk is never blocked: a direct booking still succeeds meanwhile.
    await actAs(USER_RECEPTION_A_ID);
    const fd = range(84);
    const booking = await createReservation({
      propertyId: PROP_A_ID, guestId: GUEST_RAVI_ID, source: "DIRECT", roomIds: [ROOM_101_ID],
      checkInDate: fd.checkIn, checkOutDate: fd.checkOut, adults: 1, children: 0, ratePaise: 400_000, taxPaise: 0,
    });
    expect(booking.ok).toBe(true);
    if (booking.ok) createdReservationIds.push(booking.data.id);

    await prisma.channelAccount.updateMany({ where: { id: liveAccountId }, data: { isActive: false } });
  });
});

describe("invalid signature → no side effects (T-18, FR-14, AC-14)", () => {
  it("rejects a bad signature and writes nothing", async () => {
    // Configure a webhook secret on the ingest account so the signature matters.
    await prisma.channelAccount.updateMany({ where: { id: ingestAccountId }, data: { config: { webhookSecret: "s3cret" } } });
    const r = range(90);
    const channelRef = `BDC13-${Date.now()}-sig`;
    const body = JSON.stringify(newPayload(channelRef, "DLX-BB", r));

    await expect(handleChannelWebhook({ provider: PROVIDER_BDC, rawBody: body, signature: "sha256=deadbeef" })).rejects.toMatchObject({ code: "WEBHOOK_SIGNATURE_INVALID" });
    expect(await prisma.integrationInbox.count({ where: { provider: PROVIDER_BDC, externalId: channelRef } })).toBe(0); // no side effect

    // A correct HMAC is accepted.
    const good = createHmac("sha256", "s3cret").update(body).digest("hex");
    const ok = await handleChannelWebhook({ provider: PROVIDER_BDC, rawBody: body, signature: good });
    expect(ok.status).toBe("ACCEPTED");
    await prisma.integrationInbox.deleteMany({ where: { provider: PROVIDER_BDC, externalId: channelRef } });
    await prisma.channelAccount.updateMany({ where: { id: ingestAccountId }, data: { config: {} } });
  });
});

describe("ONE availability truth — OTA + direct can't overbook a room (T-19, FR-11)", () => {
  it("a direct booking holds its room; a concurrent OTA push for the full category oversells instead of double-allocating", async () => {
    await prisma.channelAccount.updateMany({ where: { id: ingestAccountId }, data: { isActive: true } });
    const r = range(100);
    const from = new Date(`${r.checkIn}T00:00:00.000Z`);
    const to = new Date(`${r.checkOut}T00:00:00.000Z`);

    // Block every Deluxe room EXCEPT R-101 for the range.
    const deluxe = await prisma.room.findMany({ where: { propertyId: PROP_A_ID, categoryId: CAT_DLX_ID }, select: { id: true } });
    for (const room of deluxe) {
      if (room.id === ROOM_101_ID) continue;
      const block = await prisma.roomBlock.create({ data: { propertyId: PROP_A_ID, roomId: room.id, startDate: from, endDate: to, reason: "test13-onetruth" }, select: { id: true } });
      createdBlockIds.push(block.id);
    }

    // Direct booking takes R-101.
    await actAs(USER_RECEPTION_A_ID);
    const direct = await createReservation({
      propertyId: PROP_A_ID, guestId: GUEST_RAVI_ID, source: "DIRECT", roomIds: [ROOM_101_ID],
      checkInDate: r.checkIn, checkOutDate: r.checkOut, adults: 1, children: 0, ratePaise: 400_000, taxPaise: 0,
    });
    expect(direct.ok).toBe(true);
    if (direct.ok) createdReservationIds.push(direct.data.id);

    // OTA push for the same category/range: R-101 is taken, others blocked → oversell.
    const channelRef = `BDC13-${Date.now()}-truth`;
    const out = await processInboundReservation(prisma, inboxRow({ provider: PROVIDER_BDC, externalId: channelRef, type: "reservation.new", payload: newPayload(channelRef, "DLX-BB", r) }));
    createdReservationIds.push(out.reservationId!);
    expect(out.outcome).toBe("CREATED_OVERSELL");

    // R-101 was never double-allocated: exactly one allocation on it for the range.
    const allocs = await prisma.roomAllocation.count({ where: { roomId: ROOM_101_ID, startDate: { lt: to }, endDate: { gt: from } } });
    expect(allocs).toBe(1);
    expect(await prisma.roomAllocation.count({ where: { reservationId: out.reservationId! } })).toBe(0);

    await prisma.channelAccount.updateMany({ where: { id: ingestAccountId }, data: { isActive: false } });
  });
});

describe("health view (T-20, FR-19, AC-15)", () => {
  it("reports connected state, last sync, pending + dead-letter counts", async () => {
    await actAs(USER_ADMIN_ID);
    const health = await channelHealth(authMock.current!, PROP_A_ID);
    const bdc = health.find((h) => h.provider === PROVIDER_BDC);
    expect(bdc).toBeDefined();
    expect(bdc!.mappingCount).toBeGreaterThanOrEqual(1);
    expect(typeof bdc!.deadLetterCount).toBe("number");
  });
});
