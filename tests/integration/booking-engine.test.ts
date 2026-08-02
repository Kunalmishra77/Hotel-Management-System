/**
 * 23 Booking Engine integration + security — T-6..T-17 (FR-2..12/18..24).
 *
 * Exercises the PUBLIC surface end-to-end against Postgres with the sandbox
 * gateway (no live creds): availability, rate-limit (429, no side effects), bot
 * rejection, hold + idempotency, webhook signature/dedupe, success confirm,
 * hold-lost reallocate + auto-refund, fail/TTL release, coupon preview→redeem
 * once, NO OVERBOOKING under a concurrent last-room, no-PII, and staff-config
 * RBAC. Dedicated `be_`-prefixed rows + unique future date windows keep it
 * isolated from the concurrently-running suites (shared DB).
 */
import { vi, afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";

// Staff-config actions call requireUser; the public flow never does.
const requireUserMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireUser: () => requireUserMock() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { createPrismaClient } from "@/lib/db/client";
import { assembleClaims } from "@/lib/auth/claims";
import { resolvePaymentProvider } from "@/lib/payments";
import { ORG_ID, USER_ADMIN_ID, USER_RECEPTION_A_ID, PROP_A_ID } from "../../prisma/seed/fixtures";
import {
  loadPublishedConfig,
  getPublicAvailability,
  quoteBooking,
} from "@/features/booking-engine/queries";
import {
  placeHold,
  handleBookingPaymentWebhook,
  releaseExpiredWebOrders,
  getBookingStatusByReservation,
} from "@/features/booking-engine/public";
import { updateBookingEngineConfig } from "@/features/booking-engine/actions";
import { resetRateLimits } from "@/features/booking-engine/internal";
import { POST as holdPOST } from "@/app/api/booking-engine/v1/[slug]/hold/route";

const prisma = createPrismaClient();

// Financial rows (Payment/FolioLine) and everything FK-restricted by them are
// APPEND-ONLY — the dedicated property can never be torn down. So make the whole
// fixture set per-run-unique: every run books a pristine property + rooms and
// unique idempotency keys, so nothing collides with un-deletable leftovers (even
// from a previously crashed run). Same philosophy as reports.test's unique month.
const RUN = Date.now().toString(36);
const BE_PROP = `be_prop_23_${RUN}`;
const BE_CAT = `be_cat_dlx_23_${RUN}`;
const BE_ROOM_1 = `be_room_1_23_${RUN}`;
const BE_ROOM_2 = `be_room_2_23_${RUN}`;
const BE_SLUG = `be-test-site-23-${RUN}`;
const COUPON_CODE = `BESAVE10${RUN}`.slice(0, 18);

const d = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
let cfg: NonNullable<Awaited<ReturnType<typeof loadPublishedConfig>>>;

function baseHold(over: Partial<Parameters<typeof placeHold>[1]> = {}): Parameters<typeof placeHold>[1] {
  return {
    roomCategoryId: BE_CAT,
    checkInDate: d("2030-02-10"),
    checkOutDate: d("2030-02-13"),
    adults: 2,
    children: 0,
    rooms: 1,
    extraBed: false,
    guest: { fullName: "Web Guest", mobile: "9700000001", email: "web@ex.com" },
    consentAccepted: true,
    consentVersion: "2026-01-terms-v1",
    idempotencyKey: `idem-${Math.random().toString(36).slice(2)}`,
    honeypot: "",
    ...over,
  };
}

async function payWebhook(order: { orderId: string }, event: string, paymentId: string): Promise<Awaited<ReturnType<typeof handleBookingPaymentWebhook>>> {
  const rawBody = JSON.stringify({ event, orderId: order.orderId, paymentId, amountPaise: 0 });
  const signature = createHmac("sha256", resolvePaymentProvider().webhookSecret()).update(rawBody).digest("hex");
  return handleBookingPaymentWebhook({ rawBody, signature });
}

async function blockRoom(roomId: string, from: string, to: string, tag: string): Promise<void> {
  const res = await prisma.reservation.create({
    data: {
      id: `be_block_${tag}_${RUN}`, propertyId: BE_PROP, code: `B${tag}${RUN}`.slice(0, 12), guestId: (await ensureGuest()).id,
      status: "CONFIRMED", source: "WALK_IN", checkInDate: d(from), checkOutDate: d(to), nights: 3, adults: 1,
      ratePaise: 100, taxPaise: 0, advancePaise: 0,
    },
    select: { id: true },
  });
  await prisma.roomAllocation.create({ data: { propertyId: BE_PROP, reservationId: res.id, roomId, startDate: d(from), endDate: d(to) } });
}

let guestId: string | null = null;
async function ensureGuest(): Promise<{ id: string }> {
  if (guestId) return { id: guestId };
  const g = await prisma.guest.create({ data: { orgId: ORG_ID, fullName: "BE Block Guest", mobile: "enc" } });
  guestId = g.id;
  return g;
}

beforeAll(async () => {
  await prisma.property.upsert({
    where: { id: BE_PROP },
    create: {
      id: BE_PROP, orgId: ORG_ID, name: "BE Test Property", code: `BE${RUN}`.slice(0, 10),
      addressLine1: "1 Test Rd", city: "Bengaluru", state: "Karnataka", pincode: "560001",
      timezone: "Asia/Kolkata", isActive: true,
    },
    update: { isActive: true },
  });
  await prisma.roomCategory.upsert({
    where: { id: BE_CAT },
    create: { id: BE_CAT, propertyId: BE_PROP, name: "BE Deluxe", baseRatePaise: 400_000, gstBps: 1200, maxAdults: 2, maxChildren: 1 },
    update: { baseRatePaise: 400_000, gstBps: 1200 },
  });
  for (const [id, number] of [[BE_ROOM_1, "BE101"], [BE_ROOM_2, "BE102"]] as const) {
    await prisma.room.upsert({
      where: { id },
      create: { id, propertyId: BE_PROP, categoryId: BE_CAT, number, status: "VACANT", isActive: true },
      update: { status: "VACANT", isActive: true },
    });
  }
  await prisma.bookingEngineConfig.upsert({
    where: { propertyId: BE_PROP },
    create: {
      propertyId: BE_PROP, slug: BE_SLUG, onlineSellableCategoryIds: [BE_CAT], depositPolicy: "PCT",
      depositValue: 2000, checkoutTtlMin: 15, minLos: 1, leadTimeDays: 0, maxRoomsPerBooking: 5, cancelWindowHours: 48,
      gatewayProvider: "sandbox", isPublished: true,
    },
    update: { slug: BE_SLUG, onlineSellableCategoryIds: [BE_CAT], isPublished: true },
  });
  await prisma.coupon.upsert({
    where: { orgId_code: { orgId: ORG_ID, code: COUPON_CODE } },
    create: {
      orgId: ORG_ID, code: COUPON_CODE, discountType: "PERCENT", discountBps: 1000, minBookingPaise: 0,
      validFrom: d("2020-01-01"), validTo: d("2099-01-01"), usageLimitPerGuest: 5, status: "ACTIVE",
      appliesToPropertyIds: [], appliesToCategoryIds: [],
    },
    update: { status: "ACTIVE", timesUsed: 0 },
  });

  const loaded = await loadPublishedConfig(BE_SLUG);
  if (!loaded) throw new Error("config did not load");
  cfg = loaded;
  resetRateLimits();
});

afterAll(async () => {
  // Only the truly deletable per-run artifacts are cleaned. Payment + FolioLine
  // are APPEND-ONLY (DB trigger), and Folio/Reservation/Room/Property are
  // FK-restricted by them — so the dedicated BE property and its financial rows
  // persist across runs BY DESIGN. beforeAll upserts every reusable fixture and
  // each test books unique future dates, so nothing collides on re-run.
  await prisma.couponRedemption.deleteMany({ where: { coupon: { code: COUPON_CODE } } });
  await prisma.coupon.deleteMany({ where: { orgId: ORG_ID, code: COUPON_CODE } });
  await prisma.integrationInbox.deleteMany({ where: { provider: { startsWith: "booking-" } } });
  await prisma.bookingEngineOrder.deleteMany({ where: { propertyId: BE_PROP } });
  await prisma.$disconnect();
});

// --- US-1 availability -----------------------------------------------------
describe("availability (AC-1/2/3)", () => {
  it("returns GST-inclusive per-category price via 03 truth, base fallback (no 24)", async () => {
    const r = await getPublicAvailability(cfg, { checkInDate: d("2030-02-10"), checkOutDate: d("2030-02-13"), adults: 2, children: 0, rooms: 1 });
    const dlx = r.categories.find((c) => c.roomCategoryId === BE_CAT);
    expect(dlx).toBeDefined();
    expect(dlx!.totalPaise).toBe(1_344_000); // ₹4,000 × 3n + 12% GST
    // 24 resolves to the base tariff (no approved DynamicRate/plan); the safe
    // wrapper also falls back to "base" if 24 is unavailable (FR-18/AC-3).
    expect(["base", "BASE"]).toContain(dlx!.rateSource);
    expect(dlx!.available).toBeGreaterThanOrEqual(2);
  });

  it("exposes no internal room numbers or other-guest PII (FR-2/20)", async () => {
    const r = await getPublicAvailability(cfg, { checkInDate: d("2030-02-10"), checkOutDate: d("2030-02-13"), adults: 2, children: 0, rooms: 1 });
    const json = JSON.stringify(r);
    expect(json).not.toContain("BE101");
    expect(json).not.toContain("BE102");
    expect(json.toLowerCase()).not.toContain("mobile");
  });
});

// --- US-4 rate-limit + bot (AC-11/12) --------------------------------------
describe("rate limit + bot (AC-11/12)", () => {
  it("returns 429 with Retry-After and NO side effects when the limit is exceeded", async () => {
    resetRateLimits();
    const before = await prisma.bookingEngineOrder.count({ where: { propertyId: BE_PROP } });
    const req = (): Request =>
      new Request(`http://x/api/booking-engine/v1/${BE_SLUG}/hold`, {
        method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" },
        // consent false → each allowed call fails with 400 (no side effects) before the cap.
        body: JSON.stringify(baseHold({ consentAccepted: false, consentVersion: "v" })),
      });
    let last: Response | null = null;
    for (let i = 0; i < 11; i++) last = await holdPOST(req(), { params: Promise.resolve({ slug: BE_SLUG }) });
    expect(last!.status).toBe(429);
    expect(last!.headers.get("Retry-After")).toBeTruthy();
    const after = await prisma.bookingEngineOrder.count({ where: { propertyId: BE_PROP } });
    expect(after).toBe(before); // 429 + prior consent-failures created nothing
  });

  it("rejects a bot (filled honeypot) before any hold/order + audits it (AC-12)", async () => {
    resetRateLimits();
    await expect(placeHold(cfg, baseHold({ honeypot: "iam-a-bot", checkInDate: d("2031-01-10"), checkOutDate: d("2031-01-12") }), { ip: "1.1.1.1" }))
      .rejects.toMatchObject({ code: "BOT_REJECTED" });
    const audit = await prisma.auditLog.count({ where: { action: "bookingengine:bot-rejected", propertyId: BE_PROP } });
    expect(audit).toBeGreaterThanOrEqual(1);
    const orders = await prisma.bookingEngineOrder.count({ where: { propertyId: BE_PROP } });
    expect(orders).toBe(0);
  });
});

// --- US-2 hold + idempotency (AC-4/5/13/16) --------------------------------
describe("hold + order + idempotency (AC-4/5/13/16)", () => {
  it("places an ENQUIRY WEBSITE hold + deposit order with consent recorded", async () => {
    resetRateLimits();
    const held = await placeHold(cfg, baseHold({ checkInDate: d("2030-02-10"), checkOutDate: d("2030-02-13") }), { ip: "2.2.2.2" });
    expect(held.amountPaise).toBe(268_800); // 20% of ₹13,440
    const res = await prisma.reservation.findFirstOrThrow({ where: { id: held.reservationId } });
    expect(res.status).toBe("ENQUIRY");
    expect(res.source).toBe("WEBSITE");
    expect(res.holdExpiresAt).not.toBeNull();
    const order = await prisma.bookingEngineOrder.findUniqueOrThrow({ where: { gatewayOrderId: held.orderId } });
    expect(order.status).toBe("CREATED");
    expect(order.consentVersion).toBe("2026-01-terms-v1");
    expect(order.consentAt).not.toBeNull();
  });

  it("a replayed idempotency key returns the original — no second hold/order (AC-16)", async () => {
    resetRateLimits();
    const input = baseHold({ checkInDate: d("2030-03-10"), checkOutDate: d("2030-03-13"), idempotencyKey: RUN + "-dup-key-1" });
    const first = await placeHold(cfg, input, { ip: "2.2.2.2" });
    const second = await placeHold(cfg, input, { ip: "2.2.2.2" });
    expect(second.replayed).toBe(true);
    expect(second.reservationId).toBe(first.reservationId);
    expect(second.orderId).toBe(first.orderId);
    const count = await prisma.bookingEngineOrder.count({ where: { idempotencyKey: RUN + "-dup-key-1" } });
    expect(count).toBe(1);
  });
});

// --- US-3 webhook confirm / dedupe / signature (AC-6/9/10) ------------------
describe("payment webhook (AC-6/9/10)", () => {
  it("rejects a bad signature with no side effects (AC-9)", async () => {
    await expect(handleBookingPaymentWebhook({ rawBody: "{}", signature: "deadbeef" }))
      .rejects.toMatchObject({ code: "WEBHOOK_SIGNATURE_INVALID" });
  });

  it("confirms on success: CONFIRMED + folio + advance + PAID + WebBookingConfirmed (AC-6)", async () => {
    resetRateLimits();
    const held = await placeHold(cfg, baseHold({ checkInDate: d("2030-02-14"), checkOutDate: d("2030-02-17"), idempotencyKey: RUN + "-conf-1" }), { ip: "3.3.3.3" });
    const out = await payWebhook(held, "payment.captured", "pay_conf_1");
    expect(out.status).toBe("confirmed");

    const res = await prisma.reservation.findFirstOrThrow({ where: { id: held.reservationId } });
    expect(res.status).toBe("CONFIRMED");
    const folio = await prisma.folio.findFirstOrThrow({ where: { reservationId: held.reservationId } });
    const pay = await prisma.payment.findFirstOrThrow({ where: { folioId: folio.id } });
    expect(pay.mode).toBe("ONLINE");
    expect(Number(pay.amountPaise)).toBe(held.amountPaise);
    const order = await prisma.bookingEngineOrder.findUniqueOrThrow({ where: { gatewayOrderId: held.orderId } });
    expect(order.status).toBe("PAID");
    const evt = await prisma.domainEvent.count({ where: { type: "WebBookingConfirmed", aggregateId: held.reservationId } });
    expect(evt).toBe(1);
  });

  it("dedupes a duplicate webhook — idempotent, no double confirm (AC-10)", async () => {
    resetRateLimits();
    const held = await placeHold(cfg, baseHold({ checkInDate: d("2030-02-18"), checkOutDate: d("2030-02-20"), idempotencyKey: RUN + "-conf-2" }), { ip: "3.3.3.3" });
    await payWebhook(held, "payment.captured", "pay_conf_2");
    const dup = await payWebhook(held, "payment.captured", "pay_conf_2");
    expect(dup.status).toBe("duplicate");
    const folio = await prisma.folio.findFirstOrThrow({ where: { reservationId: held.reservationId } });
    const payments = await prisma.payment.count({ where: { folioId: folio.id } });
    expect(payments).toBe(1);
  });
});

// --- US-3 hold-lost + fail/TTL (AC-7/8) ------------------------------------
describe("never overbook: hold-lost + release (AC-7/8)", () => {
  it("reallocates to an equivalent room when the hold was lost (AC-7)", async () => {
    resetRateLimits();
    const held = await placeHold(cfg, baseHold({ checkInDate: d("2030-04-10"), checkOutDate: d("2030-04-13"), idempotencyKey: RUN + "-rea-1" }), { ip: "4.4.4.4" });
    // Simulate a TTL release: drop the allocation + cancel, freeing the room.
    await prisma.roomAllocation.deleteMany({ where: { reservationId: held.reservationId } });
    await prisma.reservation.update({ where: { id: held.reservationId }, data: { status: "CANCELLED" } });
    const out = await payWebhook(held, "payment.captured", "pay_rea_1");
    expect(out.status).toBe("confirmed");
    const res = await prisma.reservation.findFirstOrThrow({ where: { id: held.reservationId } });
    expect(res.status).toBe("CONFIRMED");
    const allocs = await prisma.roomAllocation.count({ where: { reservationId: held.reservationId } });
    expect(allocs).toBe(1); // an equivalent room was allocated — never overbooked
  });

  it("auto-refunds (order FAILED + WebBookingFailed) when no equivalent room is free (AC-7)", async () => {
    resetRateLimits();
    const held = await placeHold(cfg, baseHold({ checkInDate: d("2030-05-10"), checkOutDate: d("2030-05-13"), idempotencyKey: RUN + "-ref-1" }), { ip: "4.4.4.4" });
    // Block the OTHER room, then release the web hold and block its room too.
    await blockRoom(BE_ROOM_2, "2030-05-10", "2030-05-13", "r2");
    await prisma.roomAllocation.deleteMany({ where: { reservationId: held.reservationId } });
    await prisma.reservation.update({ where: { id: held.reservationId }, data: { status: "CANCELLED" } });
    await blockRoom(BE_ROOM_1, "2030-05-10", "2030-05-13", "r1");
    const out = await payWebhook(held, "payment.captured", "pay_ref_1");
    expect(out.status).toBe("failed_refunded");
    const order = await prisma.bookingEngineOrder.findUniqueOrThrow({ where: { gatewayOrderId: held.orderId } });
    expect(order.status).toBe("FAILED");
    const failed = await prisma.domainEvent.count({ where: { type: "WebBookingFailed", aggregateId: held.reservationId } });
    expect(failed).toBe(1);
  });

  it("releases the hold + terminal order on a payment failure (AC-8)", async () => {
    resetRateLimits();
    const held = await placeHold(cfg, baseHold({ checkInDate: d("2030-06-10"), checkOutDate: d("2030-06-13"), idempotencyKey: RUN + "-fail-1" }), { ip: "4.4.4.4" });
    const out = await payWebhook(held, "payment.failed", "pay_fail_1");
    expect(out.status).toBe("released");
    const res = await prisma.reservation.findFirstOrThrow({ where: { id: held.reservationId } });
    expect(res.status).toBe("CANCELLED");
    const order = await prisma.bookingEngineOrder.findUniqueOrThrow({ where: { gatewayOrderId: held.orderId } });
    expect(order.status).toBe("FAILED");
    const allocs = await prisma.roomAllocation.count({ where: { reservationId: held.reservationId } });
    expect(allocs).toBe(0); // inventory returned to sale
  });

  it("TTL sweeper releases an expired hold (EXPIRED) (AC-8)", async () => {
    resetRateLimits();
    const held = await placeHold(cfg, baseHold({ checkInDate: d("2030-07-10"), checkOutDate: d("2030-07-13"), idempotencyKey: RUN + "-ttl-1" }), { ip: "4.4.4.4" });
    const past = new Date(Date.now() - 3_600_000);
    await prisma.reservation.update({ where: { id: held.reservationId }, data: { holdExpiresAt: past } });
    await prisma.bookingEngineOrder.updateMany({ where: { gatewayOrderId: held.orderId }, data: { createdAt: past } });
    const swept = await releaseExpiredWebOrders(prisma, new Date());
    expect(swept.released).toBeGreaterThanOrEqual(1);
    const order = await prisma.bookingEngineOrder.findUniqueOrThrow({ where: { gatewayOrderId: held.orderId } });
    expect(order.status).toBe("EXPIRED");
  });
});

// --- No overbooking under concurrency (AC-7, business-rules §1) -------------
describe("no overbooking under a concurrent last-room", () => {
  it("only one of two concurrent holds wins the last room", async () => {
    resetRateLimits();
    // Leave exactly one deluxe free for the window by blocking the other.
    await blockRoom(BE_ROOM_2, "2030-08-10", "2030-08-13", "conc");
    const win = { checkInDate: d("2030-08-10"), checkOutDate: d("2030-08-13") };
    const results = await Promise.allSettled([
      placeHold(cfg, baseHold({ ...win, idempotencyKey: RUN + "-conc-a" }), { ip: "5.5.5.5" }),
      placeHold(cfg, baseHold({ ...win, idempotencyKey: RUN + "-conc-b" }), { ip: "5.5.5.6" }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    // Exactly one allocation on the last free room for the window.
    const allocs = await prisma.roomAllocation.count({ where: { propertyId: BE_PROP, roomId: BE_ROOM_1, startDate: win.checkInDate } });
    expect(allocs).toBe(1);
  });
});

// --- Coupon preview → redeem once (AC-20) ----------------------------------
describe("coupon preview then redeem-once (AC-20)", () => {
  it("preview reduces the total + deposit and consumes nothing", async () => {
    const quote = await quoteBooking(cfg, { roomCategoryId: BE_CAT, checkInDate: d("2030-09-10"), checkOutDate: d("2030-09-13"), rooms: 1, couponCode: COUPON_CODE });
    expect(quote.coupon && "discountPaise" in quote.coupon).toBe(true);
    if (quote.coupon && "discountPaise" in quote.coupon) {
      expect(quote.coupon.discountPaise).toBeGreaterThan(0);
      expect(quote.coupon.newTotalPaise).toBeLessThan(quote.totalPaise);
    }
    const coupon = await prisma.coupon.findFirstOrThrow({ where: { orgId: ORG_ID, code: COUPON_CODE } });
    expect(coupon.timesUsed).toBe(0); // nothing consumed on preview
  });

  it("redeems once inside the confirm tx; an abandoned checkout redeems nothing", async () => {
    resetRateLimits();
    // Abandoned: hold with coupon, then FAIL → timesUsed unchanged.
    const abandoned = await placeHold(cfg, baseHold({ checkInDate: d("2030-09-14"), checkOutDate: d("2030-09-16"), couponCode: COUPON_CODE, idempotencyKey: RUN + "-cpn-ab" }), { ip: "6.6.6.6" });
    await payWebhook(abandoned, "payment.failed", "pay_cpn_ab");
    let coupon = await prisma.coupon.findFirstOrThrow({ where: { orgId: ORG_ID, code: COUPON_CODE } });
    expect(coupon.timesUsed).toBe(0);

    // Confirmed: hold with coupon, then SUCCESS → redeemed exactly once.
    const held = await placeHold(cfg, baseHold({ checkInDate: d("2030-09-18"), checkOutDate: d("2030-09-20"), couponCode: COUPON_CODE, idempotencyKey: RUN + "-cpn-ok" }), { ip: "6.6.6.6" });
    await payWebhook(held, "payment.captured", "pay_cpn_ok");
    coupon = await prisma.coupon.findFirstOrThrow({ where: { orgId: ORG_ID, code: COUPON_CODE } });
    expect(coupon.timesUsed).toBe(1);
    const redemptions = await prisma.couponRedemption.count({ where: { couponId: coupon.id, reservationId: held.reservationId } });
    expect(redemptions).toBe(1);
    const evt = await prisma.domainEvent.count({ where: { type: "CouponRedeemed" } });
    expect(evt).toBeGreaterThanOrEqual(1);
  });
});

// --- Self-service status is PII-safe (FR-20) -------------------------------
describe("self-service status is PII-safe (FR-20)", () => {
  it("returns only the caller's own booking fields — no guest PII", async () => {
    resetRateLimits();
    const held = await placeHold(cfg, baseHold({ checkInDate: d("2030-10-10"), checkOutDate: d("2030-10-13"), idempotencyKey: RUN + "-st-1", guest: { fullName: "Secret Person", mobile: "9700000099" } }), { ip: "7.7.7.7" });
    const status = await getBookingStatusByReservation(held.reservationId);
    const json = JSON.stringify(status);
    expect(json).not.toContain("Secret Person");
    expect(json).not.toContain("9700000099");
    expect(status!.reservationCode).toBeTruthy();
  });
});

// --- Staff config RBAC (AC-19) --------------------------------------------
describe("staff config RBAC (AC-19)", () => {
  async function claims(userId: string) {
    const c = await assembleClaims(prisma, userId);
    if (!c) throw new Error("no claims");
    return c;
  }

  it("admin (bookingengine:manage) can update the config", async () => {
    requireUserMock.mockResolvedValue(await claims(USER_ADMIN_ID));
    const res = await updateBookingEngineConfig({ propertyId: BE_PROP, checkoutTtlMin: 20 });
    expect(res.ok).toBe(true);
    const cfgRow = await prisma.bookingEngineConfig.findUniqueOrThrow({ where: { propertyId: BE_PROP } });
    expect(cfgRow.checkoutTtlMin).toBe(20);
    // restore
    await prisma.bookingEngineConfig.update({ where: { propertyId: BE_PROP }, data: { checkoutTtlMin: 15 } });
  });

  it("a user without the permission is denied (FORBIDDEN); public flow stays open", async () => {
    requireUserMock.mockResolvedValue(await claims(USER_RECEPTION_A_ID));
    // Use PROP_A (in reception's scope) so this is a pure permission denial, not scope.
    const res = await updateBookingEngineConfig({ propertyId: PROP_A_ID, checkoutTtlMin: 99 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
  });
});
