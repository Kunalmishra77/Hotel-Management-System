/**
 * Booking-engine public orchestration — 23 T-9..T-16 (FR-4..9/12/16/19/22/23).
 *
 * UNAUTHENTICATED but system-driven, mirroring 03 `createFromChannel` + 06
 * `handlePaymentWebhook`: everything runs on the UNSCOPED client inside
 * `runWithSystemContext(orgId)`. NO OVERBOOKING is guaranteed by the DB — every
 * allocation insert is inside a SERIALIZABLE transaction and the `room_no_overlap`
 * exclusion constraint is the final backstop, exactly as 03's booking core does.
 *
 * INTEGRATION NOTE (delta): 03's hold/confirm/cancel/reallocate public actions
 * require an authenticated user (`requireUser`), which a public web booking has
 * none of. This module therefore performs the reservation writes directly under
 * a system context — reusing 03's availability truth (`findFreeRooms`) and 06's
 * `ensureFolio` — rather than forking availability logic. Ideally 03 grows
 * system-callable variants; the parent reconciles at merge.
 */
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { emitEvent } from "@/lib/events";
import { writeAudit } from "@/lib/audit";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { resolvePaymentProvider } from "@/lib/payments";
import { receiveInbound, verifyWebhookSignature } from "@/lib/integrations/inbox";
import { ensureFolio } from "@/features/billing";
import { computeCouponDiscount, type CouponLike } from "@/features/billing/domain/coupon-discount";
import { discountLine } from "@/features/billing/domain/money";
import { findFreeRooms, type RoomFinder } from "@/features/reservations/availability";
import { nights as computeNights } from "@/features/reservations/domain/nights";
import {
  bookingDb,
  isBotRequest,
  signBookingToken,
  upsertPublicGuest,
  withBookingSystemContext,
} from "./internal";
import { depositForPreference } from "./domain/deposit";
import { gstInclusiveDisplay } from "./domain/gst-display";
import { validateStayConstraints } from "./domain/constraints";
import { loadPublishedConfig, previewCoupon, resolveStayNetPerRoom, type PublishedConfig } from "./queries";
import type { HoldInput, PaymentPreference } from "./schema";

const SUCCESS_EVENTS = new Set(["payment.captured", "payment.success", "order.paid"]);
const FAILURE_EVENTS = new Set(["payment.failed", "payment.cancelled", "order.failed", "payment.abandoned"]);

// ---------------------------------------------------------------------------
// Small date helpers (property-local) — inlined to avoid a cross-module import.
// ---------------------------------------------------------------------------
function localEpochDay(date: Date, tz: string): number {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date).split("-").map(Number);
  return Math.round(Date.UTC(y!, m! - 1, d!) / 86_400_000);
}
function utcEpochDay(date: Date): number {
  return Math.round(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000);
}

function generateWebCode(now: Date = new Date()): string {
  const stamp = now.getTime().toString(36).toUpperCase().slice(-6);
  const rand = Math.floor(Math.random() * 36 ** 2).toString(36).toUpperCase().padStart(2, "0");
  return `WEB-${stamp}${rand}`;
}

export type HoldResult = {
  reservationId: string;
  reservationCode: string;
  orderId: string;
  amountPaise: number;
  totalPaise: number;
  selfServiceToken: string;
  /** Only the gateway params the client needs — never secrets (FR-5, AC-5). */
  gateway: { provider: string; orderId: string; amountPaise: number };
  replayed: boolean;
  /** The payment path taken. Anonymous callers are always PARTIAL (deposit). */
  paymentPreference: PaymentPreference;
  /** True when already CONFIRMED (pay-at-hotel) — no online payment is due. */
  confirmed: boolean;
};

/**
 * Place a temporary hold + create the deposit order (FR-4/5/12/22).
 * `ip` drives the audit trail; rate-limit + bot pre-check happen at the route,
 * but bot signals are re-checked here so the domain path is safe on its own.
 */
export async function placeHold(
  cfg: PublishedConfig,
  input: HoldInput,
  meta: { ip: string; allowPaymentPreference?: boolean },
): Promise<HoldResult> {
  const prisma = bookingDb();

  // FR-22: a replayed idempotency key returns the original result, no new hold.
  const existing = await prisma.bookingEngineOrder.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true, gatewayOrderId: true, amountPaise: true, reservationId: true },
  });
  if (existing && existing.reservationId) {
    const res = await prisma.reservation.findFirst({
      where: { id: existing.reservationId },
      select: { code: true },
    });
    return {
      reservationId: existing.reservationId,
      reservationCode: res?.code ?? "",
      orderId: existing.gatewayOrderId,
      amountPaise: existing.amountPaise,
      totalPaise: existing.amountPaise,
      selfServiceToken: signBookingToken({
        orderId: existing.gatewayOrderId,
        reservationId: existing.reservationId,
        exp: Date.now() + 30 * 86_400_000,
      }),
      gateway: { provider: resolvePaymentProvider().name, orderId: existing.gatewayOrderId, amountPaise: existing.amountPaise },
      replayed: true,
      // A 0-amount order is the pay-at-hotel marker → already confirmed.
      paymentPreference: existing.amountPaise === 0 ? "PAY_AT_HOTEL" : "PARTIAL",
      confirmed: existing.amountPaise === 0,
    };
  }

  // FR-11: bot rejection BEFORE any hold/order (audited).
  if (isBotRequest({ honeypot: input.honeypot, captchaToken: input.captchaToken })) {
    await auditBotRejection(prisma, cfg, meta.ip);
    throw new DomainError(ErrorCode.BOT_REJECTED);
  }

  // FR-12: explicit consent is mandatory.
  if (!input.consentAccepted || !input.consentVersion) {
    throw new DomainError(ErrorCode.CONSENT_REQUIRED);
  }

  // FR-2: only an online-sellable category may be booked.
  if (!cfg.onlineSellableCategoryIds.includes(input.roomCategoryId)) {
    throw new NotFoundError("That room type isn't available for online booking.");
  }

  const category = await prisma.roomCategory.findFirst({
    where: { id: input.roomCategoryId, propertyId: cfg.propertyId },
    select: { id: true, name: true, baseRatePaise: true, gstBps: true, maxAdults: true, maxChildren: true },
  });
  if (!category) throw new NotFoundError("Room type not found.");

  const n = computeNights(input.checkInDate, input.checkOutDate, cfg.timezone);
  const leadDays = utcEpochDay(input.checkInDate) - localEpochDay(new Date(), cfg.timezone);

  // FR-14: stay constraints — nothing persists on violation.
  const constraint = validateStayConstraints(
    {
      nights: n,
      leadDays,
      rooms: input.rooms,
      adults: input.adults,
      children: input.children,
      extraBed: input.extraBed,
      category: { maxAdults: category.maxAdults, maxChildren: category.maxChildren },
    },
    cfg,
  );
  if (!constraint.ok) {
    throw new DomainError(ErrorCode.STAY_CONSTRAINT_VIOLATION, constraint.reason, { publicMessage: constraint.reason });
  }

  // Pricing — 24 resolved rate (base fallback) → GST-inclusive total (FR-3/15).
  const { netPerRoomPaise } = await resolveStayNetPerRoom({
    orgId: cfg.orgId, propertyId: cfg.propertyId, roomCategoryId: category.id,
    baseRatePaise: category.baseRatePaise, checkInDate: input.checkInDate, nights: n,
  });
  const bookingNet = netPerRoomPaise * input.rooms;
  const display = gstInclusiveDisplay(bookingNet, 1, category.gstBps, 1);

  // Coupon preview (no consume) → discounted total drives the deposit (FR-23).
  let couponDiscount = 0;
  let couponCode: string | null = null;
  if (input.couponCode) {
    const preview = await previewCoupon({
      orgId: cfg.orgId, propertyId: cfg.propertyId, roomCategoryId: category.id,
      code: input.couponCode, bookingNetPaise: bookingNet, grossPaise: display.grossPaise, cfg,
    });
    if (preview.ok) {
      couponDiscount = preview.discountPaise;
      couponCode = input.couponCode;
    }
    // Invalid/expired/exhausted → proceed WITHOUT the coupon (FR-24).
  }

  const totalPaise = Math.max(0, display.grossPaise - couponDiscount);

  // Payment path (FR-5 + customer redesign). Anonymous callers omit the
  // preference → PARTIAL/deposit, exactly as before. Signed-in guests may choose:
  //   PAY_NOW      → the whole total online now,
  //   PARTIAL      → the configured deposit online now,
  //   PAY_AT_HOTEL → nothing online; the booking confirms and is paid on arrival.
  // The preference is honoured ONLY when the caller is trusted to set it (the
  // signed-in guest booking action). The public route leaves it off, so an
  // anonymous caller can never reach PAY_AT_HOTEL / PAY_NOW and always pays the
  // configured deposit.
  const preference: PaymentPreference = meta.allowPaymentPreference
    ? input.paymentPreference ?? "PARTIAL"
    : "PARTIAL";
  const payAtHotel = preference === "PAY_AT_HOTEL";
  const deposit = depositForPreference(preference, totalPaise, cfg);
  const nightlyRate = Math.round(netPerRoomPaise / n);
  const holdExpiresAt = new Date(Date.now() + cfg.checkoutTtlMin * 60_000);

  // --- The atomic hold transaction (SERIALIZABLE; exclusion constraint = no
  //     overbooking) ------------------------------------------------------
  const held = await withBookingSystemContext(cfg.orgId, () =>
    runBooking(() =>
      prisma.$transaction(
        async (tx) => {
          const guest = await upsertPublicGuest(tx as unknown as PrismaClient, {
            orgId: cfg.orgId,
            fullName: input.guest.fullName,
            mobile: input.guest.mobile,
            email: input.guest.email,
            city: input.guest.city,
            state: input.guest.state,
          });

          // Re-check availability under the lock; pick `rooms` free rooms.
          const free = await findFreeRooms(tx as unknown as RoomFinder, {
            propertyId: cfg.propertyId,
            categoryId: category.id,
            adults: input.adults,
            children: input.children,
            checkInDate: input.checkInDate,
            checkOutDate: input.checkOutDate,
          });
          if (free.length < input.rooms) throw new DomainError(ErrorCode.ROOM_UNAVAILABLE);
          const chosen = free.slice(0, input.rooms).map((r) => r.id);

          let reservation: { id: string; code: string } | null = null;
          for (let attempt = 0; attempt < 3 && !reservation; attempt++) {
            try {
              reservation = await tx.reservation.create({
                data: {
                  propertyId: cfg.propertyId,
                  code: generateWebCode(),
                  guestId: guest.id,
                  // Pay-at-hotel confirms immediately (the guest is identified);
                  // the paid paths stay a hold until the gateway webhook confirms.
                  status: payAtHotel ? "CONFIRMED" : "ENQUIRY",
                  source: "WEBSITE",
                  checkInDate: input.checkInDate,
                  checkOutDate: input.checkOutDate,
                  nights: n,
                  adults: input.adults,
                  children: input.children,
                  holdExpiresAt: payAtHotel ? null : holdExpiresAt,
                  ratePaise: nightlyRate,
                  discountPaise: couponDiscount,
                  extraBedPaise: 0,
                  taxPaise: display.taxPaise,
                  otherChargesPaise: 0,
                  advancePaise: deposit,
                  // Carry the category (so a lost hold can be reallocated to an
                  // equivalent room, FR-8) + the coupon (redeemed once at confirm,
                  // FR-23) in a structured note.
                  notes: JSON.stringify({ src: "booking-engine", roomCategoryId: category.id, ...(couponCode ? { couponCode } : {}) }),
                },
                select: { id: true, code: true },
              });
            } catch (e) {
              if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt < 2) continue;
              throw e;
            }
          }
          if (!reservation) throw new DomainError(ErrorCode.CONFLICT, "Could not allocate a booking code.");

          for (const roomId of chosen) {
            await tx.roomAllocation.create({
              data: {
                propertyId: cfg.propertyId,
                reservationId: reservation.id,
                roomId,
                startDate: input.checkInDate,
                endDate: input.checkOutDate,
              },
            });
          }
          await tx.room.updateMany({ where: { id: { in: chosen } }, data: { status: "RESERVED" } });
          for (const roomId of chosen) {
            await emitEvent(tx, {
              type: "RoomStatusChanged", aggregateId: roomId, propertyId: cfg.propertyId,
              payload: { to: "RESERVED", reason: "web-hold", reservationId: reservation.id },
            });
          }

          await emitEvent(tx, {
            type: "ReservationCreated", aggregateId: reservation.id, propertyId: cfg.propertyId,
            payload: {
              code: reservation.code,
              status: payAtHotel ? "CONFIRMED" : "ENQUIRY",
              source: "WEBSITE", hold: !payAtHotel, nights: n,
            },
          });
          await writeAudit(tx, {
            action: payAtHotel ? "bookingengine:book" : "bookingengine:hold",
            entityType: "Reservation", entityId: reservation.id, propertyId: cfg.propertyId,
            after: { code: reservation.code, rooms: chosen.length, preference, holdExpiresAt: payAtHotel ? null : holdExpiresAt },
          });

          return { reservationId: reservation.id, reservationCode: reservation.code, guestId: guest.id };
        },
        { isolationLevel: "Serializable", maxWait: 10_000, timeout: 15_000 },
      ),
    ),
  );

  // Pay-at-hotel: no online payment. Record a settled 0-amount order (same
  // idempotency + audit trail as a paid booking, but no gateway call). The
  // booking is already CONFIRMED, so nothing further is owed online.
  if (payAtHotel) {
    const synthOrderId = `pah_${held.reservationId}`;
    try {
      await withBookingSystemContext(cfg.orgId, () =>
        prisma.$transaction(async (tx) => {
          const row = await tx.bookingEngineOrder.create({
            data: {
              propertyId: cfg.propertyId,
              reservationId: held.reservationId,
              gatewayOrderId: synthOrderId,
              amountPaise: 0,
              status: "PAID", // nothing to collect online
              idempotencyKey: input.idempotencyKey,
              consentVersion: input.consentVersion,
              consentAt: new Date(),
            },
            select: { id: true },
          });
          await writeAudit(tx, {
            action: "bookingengine:book-pay-at-hotel", entityType: "Reservation",
            entityId: held.reservationId, propertyId: cfg.propertyId,
            after: { orderId: row.id, confirmed: true, preference },
          });
        }),
      );
    } catch (e) {
      // A duplicate idempotency key = the booking is already recorded; ignore.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
    return {
      reservationId: held.reservationId,
      reservationCode: held.reservationCode,
      orderId: synthOrderId,
      amountPaise: 0,
      totalPaise,
      selfServiceToken: signBookingToken({
        orderId: synthOrderId, reservationId: held.reservationId, exp: Date.now() + 30 * 86_400_000,
      }),
      gateway: { provider: "none", orderId: synthOrderId, amountPaise: 0 },
      replayed: false,
      paymentPreference: preference,
      confirmed: true,
    };
  }

  // Create the gateway order (sandbox if no live creds) — external, post-commit.
  const provider = resolvePaymentProvider();
  const order = await provider.createOrder({ amountPaise: deposit, receipt: held.reservationId });

  // Persist the BookingEngineOrder binding (idempotency key race → return original).
  let orderRow: { id: string; gatewayOrderId: string; amountPaise: number };
  try {
    orderRow = await withBookingSystemContext(cfg.orgId, () =>
      prisma.$transaction(async (tx) => {
        const row = await tx.bookingEngineOrder.create({
          data: {
            propertyId: cfg.propertyId,
            reservationId: held.reservationId,
            gatewayOrderId: order.orderId,
            amountPaise: deposit,
            status: "CREATED",
            idempotencyKey: input.idempotencyKey,
            consentVersion: input.consentVersion,
            consentAt: new Date(),
          },
          select: { id: true, gatewayOrderId: true, amountPaise: true },
        });
        await writeAudit(tx, {
          action: "bookingengine:order-create", entityType: "BookingEngineOrder", entityId: row.id, propertyId: cfg.propertyId,
          after: { gatewayOrderId: row.gatewayOrderId, amountPaise: row.amountPaise, reservationId: held.reservationId },
        });
        return row;
      }),
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const dup = await prisma.bookingEngineOrder.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { gatewayOrderId: true, amountPaise: true },
      });
      if (dup) orderRow = { id: "", gatewayOrderId: dup.gatewayOrderId, amountPaise: dup.amountPaise };
      else throw e;
    } else throw e;
  }

  return {
    reservationId: held.reservationId,
    reservationCode: held.reservationCode,
    orderId: orderRow.gatewayOrderId,
    amountPaise: orderRow.amountPaise,
    totalPaise,
    selfServiceToken: signBookingToken({
      orderId: orderRow.gatewayOrderId, reservationId: held.reservationId, exp: Date.now() + 30 * 86_400_000,
    }),
    gateway: { provider: provider.name, orderId: orderRow.gatewayOrderId, amountPaise: orderRow.amountPaise },
    replayed: false,
    paymentPreference: preference,
    confirmed: false,
  };
}

// ---------------------------------------------------------------------------
// Payment webhook (FR-6/7/8/9/19).
// ---------------------------------------------------------------------------

export type WebhookOutcome = { status: "confirmed" | "failed_refunded" | "released" | "duplicate" | "ignored" };

/**
 * Process the gateway webhook: verify signature FIRST → find order → inbox dedupe
 * → confirm / hold-lost-refund / release. Idempotent under retries (FR-19).
 */
export async function handleBookingPaymentWebhook(params: { rawBody: string; signature: string }): Promise<WebhookOutcome> {
  const provider = resolvePaymentProvider();
  if (!verifyWebhookSignature({ rawBody: params.rawBody, signature: params.signature, secret: provider.webhookSecret() })) {
    throw new DomainError(ErrorCode.WEBHOOK_SIGNATURE_INVALID);
  }

  const payload = JSON.parse(params.rawBody) as {
    event: string; orderId: string; paymentId: string; amountPaise?: number;
  };
  const prisma = bookingDb();

  // Find the order first: if a webhook races ahead of the order commit, throw so
  // the provider retries — WITHOUT recording an inbox row that would later dedupe
  // the real delivery away (design.md: "inbox holds; processed once order exists").
  const order = await prisma.bookingEngineOrder.findUnique({ where: { gatewayOrderId: payload.orderId } });
  if (!order) throw new NotFoundError("Order not found for webhook.");

  const property = await prisma.property.findUniqueOrThrow({ where: { id: order.propertyId }, select: { orgId: true, state: true } });

  // Dedupe on the provider event id — a retried webhook does nothing extra (FR-19, AC-10).
  const received = await receiveInbound(prisma, {
    provider: `booking-${provider.name}`,
    externalId: payload.paymentId,
    type: payload.event,
    payload,
  });
  if (received.kind === "DUPLICATE") return { status: "duplicate" };

  if (order.status === "PAID") return { status: "duplicate" }; // already confirmed

  if (FAILURE_EVENTS.has(payload.event)) {
    await releaseHold(prisma, property.orgId, order, "payment-failed");
    return { status: "released" };
  }
  if (!SUCCESS_EVENTS.has(payload.event)) return { status: "ignored" };

  // --- Success: confirm the still-valid hold, or handle hold-lost (FR-7/8) ---
  const reservation = order.reservationId
    ? await prisma.reservation.findFirst({
        where: { id: order.reservationId },
        select: { id: true, code: true, status: true, guestId: true, propertyId: true, notes: true, holdExpiresAt: true,
          allocations: { select: { roomId: true, room: { select: { categoryId: true } } } } },
      })
    : null;

  const holdLost =
    !reservation ||
    (reservation.status !== "ENQUIRY" && reservation.status !== "CONFIRMED") ||
    reservation.allocations.length === 0;

  if (holdLost) {
    return handleHoldLost(prisma, property.orgId, order, reservation);
  }

  await withBookingSystemContext(property.orgId, () =>
    prisma.$transaction(async (tx) => {
      // Confirm (idempotent if already CONFIRMED) + ensure folio (FR-7).
      if (reservation!.status === "ENQUIRY") {
        await tx.reservation.updateMany({ where: { id: reservation!.id }, data: { status: "CONFIRMED", holdExpiresAt: null } });
      }
      const folioId = await ensureFolio(tx, { reservationId: reservation!.id, propertyId: order.propertyId });

      // Advance payment (FR-7) — mirrors 06 online-payment: mode ONLINE, positive.
      await tx.payment.create({
        data: {
          propertyId: order.propertyId, folioId, mode: "ONLINE",
          amountPaise: BigInt(order.amountPaise), gatewayOrderId: order.gatewayOrderId,
          reference: payload.paymentId, isRefund: false,
        },
      });

      // Coupon: redeem ONCE, atomically, inside this same tx (FR-23, AC-20). A
      // coupon that has become invalid/exhausted is skipped, not fatal (FR-24).
      const couponCode = parseCouponCode(reservation!.notes);
      if (couponCode) {
        await tryRedeemCoupon(tx, {
          orgId: property.orgId, code: couponCode, guestId: reservation!.guestId,
          reservationId: reservation!.id, folioId, propertyId: order.propertyId,
          propertyState: property.state, bookingNetPaise: 0,
        });
      }

      await tx.bookingEngineOrder.updateMany({ where: { id: order.id }, data: { status: "PAID" } });

      await emitEvent(tx, {
        type: "WebBookingConfirmed", aggregateId: reservation!.id, propertyId: order.propertyId,
        payload: { code: reservation!.code, orderId: order.gatewayOrderId, advancePaise: order.amountPaise, source: "WEBSITE" },
      });
      await emitEvent(tx, {
        type: "PaymentReceived", aggregateId: folioId, propertyId: order.propertyId,
        payload: { folioId, tenders: [{ mode: "ONLINE", amountPaise: order.amountPaise }] },
      });
      await writeAudit(tx, {
        action: "bookingengine:confirm", entityType: "Reservation", entityId: reservation!.id, propertyId: order.propertyId,
        after: { status: "CONFIRMED", advancePaise: order.amountPaise, orderId: order.gatewayOrderId },
      });
    }),
  );

  return { status: "confirmed" };
}

/** FR-8: paid but hold lost → reallocate an equivalent room, else auto-refund. */
async function handleHoldLost(
  prisma: PrismaClient,
  orgId: string,
  order: { id: string; propertyId: string; gatewayOrderId: string; amountPaise: number; reservationId: string | null },
  reservation: { id: string; code: string; propertyId: string; checkInDate?: Date; checkOutDate?: Date } | null,
): Promise<WebhookOutcome> {
  // Try to re-allocate to an equivalent free room in the same category. We need
  // the reservation's dates + category; reload fully (it may have been cancelled).
  const full = order.reservationId
    ? await prisma.reservation.findFirst({
        where: { id: order.reservationId },
        select: { id: true, code: true, status: true, notes: true, checkInDate: true, checkOutDate: true, adults: true, children: true,
          allocations: { select: { roomId: true, room: { select: { categoryId: true } } } } },
      })
    : null;

  let reallocated = false;
  // Revive from a still-live hold OR from a TTL-released (CANCELLED) reservation —
  // FR-8 reallocates to an equivalent room; never touch an in-house/checked-out one.
  const revivable = full && (full.status === "ENQUIRY" || full.status === "CONFIRMED" || full.status === "CANCELLED");
  if (full && revivable) {
    // Category from a surviving allocation, else recovered from the hold's note.
    const categoryId = full.allocations[0]?.room.categoryId ?? parseCategoryId(full.notes);
    if (categoryId) {
      try {
        await withBookingSystemContext(orgId, () =>
          runBooking(() =>
            prisma.$transaction(
              async (tx) => {
                const free = await findFreeRooms(tx as unknown as RoomFinder, {
                  propertyId: order.propertyId, categoryId,
                  checkInDate: full.checkInDate, checkOutDate: full.checkOutDate,
                });
                if (free.length === 0) throw new DomainError(ErrorCode.ROOM_UNAVAILABLE);
                const roomId = free[0]!.id;
                await tx.roomAllocation.create({
                  data: { propertyId: order.propertyId, reservationId: full.id, roomId, startDate: full.checkInDate, endDate: full.checkOutDate },
                });
                await tx.room.updateMany({ where: { id: roomId }, data: { status: "RESERVED" } });
                await tx.reservation.updateMany({ where: { id: full.id }, data: { status: "CONFIRMED", holdExpiresAt: null } });
                const folioId = await ensureFolio(tx, { reservationId: full.id, propertyId: order.propertyId });
                await tx.payment.create({
                  data: { propertyId: order.propertyId, folioId, mode: "ONLINE", amountPaise: BigInt(order.amountPaise), gatewayOrderId: order.gatewayOrderId, isRefund: false },
                });
                await tx.bookingEngineOrder.updateMany({ where: { id: order.id }, data: { status: "PAID" } });
                await emitEvent(tx, { type: "WebBookingConfirmed", aggregateId: full.id, propertyId: order.propertyId, payload: { code: full.code, orderId: order.gatewayOrderId, reallocated: true, source: "WEBSITE" } });
                await writeAudit(tx, { action: "bookingengine:reallocate-confirm", entityType: "Reservation", entityId: full.id, propertyId: order.propertyId, after: { roomId, orderId: order.gatewayOrderId } });
              },
              { isolationLevel: "Serializable", maxWait: 10_000, timeout: 15_000 },
            ),
          ),
        );
        reallocated = true;
      } catch (e) {
        logger.info("booking-engine.reallocate_failed", { orderId: order.gatewayOrderId, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  if (reallocated) return { status: "confirmed" };

  // No equivalent room free → auto-refund via the gateway (NOT 06 — the booking
  // never confirmed, so no folio exists) and mark the order failed (FR-8).
  const provider = resolvePaymentProvider();
  if (typeof (provider as { refund?: unknown }).refund === "function") {
    try {
      await (provider as unknown as { refund: (a: { orderId: string; amountPaise: number }) => Promise<unknown> }).refund({
        orderId: order.gatewayOrderId, amountPaise: order.amountPaise,
      });
    } catch (e) {
      logger.error("booking-engine.auto_refund_failed", { orderId: order.gatewayOrderId, error: e instanceof Error ? e.message : String(e) });
    }
  }

  await withBookingSystemContext(orgId, () =>
    prisma.$transaction(async (tx) => {
      await tx.bookingEngineOrder.updateMany({ where: { id: order.id }, data: { status: "FAILED" } });
      if (reservation) {
        await emitEvent(tx, { type: "WebBookingFailed", aggregateId: reservation.id, propertyId: order.propertyId, payload: { code: reservation.code, reason: "hold-lost", refundedPaise: order.amountPaise } });
        await writeAudit(tx, { action: "bookingengine:auto-refund", entityType: "BookingEngineOrder", entityId: order.id, propertyId: order.propertyId, reason: "Hold lost after payment; no equivalent room free", after: { refundedPaise: order.amountPaise } });
      } else {
        await emitEvent(tx, { type: "WebBookingFailed", aggregateId: order.id, propertyId: order.propertyId, payload: { reason: "hold-lost", refundedPaise: order.amountPaise } });
        await writeAudit(tx, { action: "bookingengine:auto-refund", entityType: "BookingEngineOrder", entityId: order.id, propertyId: order.propertyId, reason: "Hold lost after payment; reservation gone", after: { refundedPaise: order.amountPaise } });
      }
    }),
  );
  return { status: "failed_refunded" };
}

/** FR-9: release the hold (inventory returns to sale) + mark the order terminal. */
async function releaseHold(
  prisma: PrismaClient,
  orgId: string,
  order: { id: string; propertyId: string; reservationId: string | null; gatewayOrderId: string },
  reason: string,
  terminalStatus: "FAILED" | "EXPIRED" = "FAILED",
): Promise<void> {
  await withBookingSystemContext(orgId, () =>
    prisma.$transaction(async (tx) => {
      if (order.reservationId) {
        const r = await tx.reservation.findFirst({
          where: { id: order.reservationId },
          select: { id: true, status: true, allocations: { select: { roomId: true } } },
        });
        // Only release a still-tentative hold — never a confirmed/paid booking.
        if (r && r.status === "ENQUIRY") {
          const roomIds = r.allocations.map((a) => a.roomId);
          await tx.roomAllocation.deleteMany({ where: { reservationId: r.id } });
          await tx.reservation.updateMany({ where: { id: r.id }, data: { status: "CANCELLED", holdExpiresAt: null } });
          if (roomIds.length) {
            await tx.room.updateMany({ where: { id: { in: roomIds } }, data: { status: "VACANT" } });
            for (const roomId of roomIds) {
              await emitEvent(tx, { type: "RoomStatusChanged", aggregateId: roomId, propertyId: order.propertyId, payload: { to: "VACANT", reason } });
            }
          }
          await emitEvent(tx, { type: "ReservationCancelled", aggregateId: r.id, propertyId: order.propertyId, payload: { reason } });
        }
      }
      await tx.bookingEngineOrder.updateMany({ where: { id: order.id }, data: { status: terminalStatus } });
      await writeAudit(tx, { action: "bookingengine:release", entityType: "BookingEngineOrder", entityId: order.id, propertyId: order.propertyId, reason, after: { status: terminalStatus } });
    }),
  );
}

// ---------------------------------------------------------------------------
// TTL sweeper (FR-9) — pg-boss job. Marks CREATED orders whose checkout TTL has
// elapsed as EXPIRED and releases their hold. Coexists with 03's own hold
// sweeper (`reservations/jobs.releaseExpiredHolds`), which may cancel the
// ENQUIRY reservation first: this still finalizes the ORDER (03 doesn't know
// about orders). Idempotent — a PAID order or a live hold is left untouched.
// ---------------------------------------------------------------------------
export async function releaseExpiredWebOrders(prisma: PrismaClient, now: Date = new Date()): Promise<{ released: number }> {
  // Grace: only sweep orders older than a minute, so a just-created order awaiting
  // its first webhook is never swept out from under the guest.
  const stale = await prisma.bookingEngineOrder.findMany({
    where: { status: "CREATED", reservationId: { not: null }, createdAt: { lt: new Date(now.getTime() - 60_000) } },
    select: { id: true, propertyId: true, reservationId: true, gatewayOrderId: true },
  });
  let released = 0;
  for (const order of stale) {
    const r = await prisma.reservation.findFirst({
      where: { id: order.reservationId! },
      select: { status: true, holdExpiresAt: true },
    });
    if (!r) continue;
    const property = await prisma.property.findUniqueOrThrow({ where: { id: order.propertyId }, select: { orgId: true } });

    if (r.status === "ENQUIRY" && r.holdExpiresAt && r.holdExpiresAt < now) {
      // Hold still live but expired — release it and finalize the order.
      await releaseHold(prisma, property.orgId, order, "ttl-expired", "EXPIRED");
      released += 1;
    } else if (r.status === "CANCELLED" || r.status === "NO_SHOW") {
      // 03's sweeper already released the hold — just finalize the order.
      await withBookingSystemContext(property.orgId, () =>
        prisma.$transaction(async (tx) => {
          await tx.bookingEngineOrder.updateMany({ where: { id: order.id }, data: { status: "EXPIRED" } });
          await writeAudit(tx, { action: "bookingengine:release", entityType: "BookingEngineOrder", entityId: order.id, propertyId: order.propertyId, reason: "ttl-expired", after: { status: "EXPIRED" } });
        }),
      );
      released += 1;
    }
    // ENQUIRY-but-not-yet-expired, or CONFIRMED/IN_HOUSE → leave for the webhook.
  }
  return { released };
}

// ---------------------------------------------------------------------------
// Self-service (FR-16) — status + windowed cancel via signed link.
// ---------------------------------------------------------------------------

export type BookingStatus = {
  reservationCode: string;
  status: string;
  checkInDate: Date;
  checkOutDate: Date;
  nights: number;
  totalPaise: number;
  advancePaise: number;
  cancellable: boolean;
};

export async function getBookingStatusByReservation(reservationId: string): Promise<BookingStatus | null> {
  const prisma = bookingDb();
  const r = await prisma.reservation.findFirst({
    where: { id: reservationId },
    select: { code: true, status: true, checkInDate: true, checkOutDate: true, nights: true, taxPaise: true, ratePaise: true, discountPaise: true, advancePaise: true, propertyId: true },
  });
  if (!r) return null;
  const cfg = await prisma.bookingEngineConfig.findUnique({ where: { propertyId: r.propertyId }, select: { cancelWindowHours: true } });
  const hoursToCheckIn = (r.checkInDate.getTime() - Date.now()) / 3_600_000;
  const cancellable =
    (r.status === "CONFIRMED" || r.status === "ENQUIRY") &&
    hoursToCheckIn >= (cfg?.cancelWindowHours ?? 48);
  return {
    reservationCode: r.code, status: r.status, checkInDate: r.checkInDate, checkOutDate: r.checkOutDate,
    nights: r.nights, totalPaise: r.ratePaise * r.nights + r.taxPaise - r.discountPaise, advancePaise: r.advancePaise,
    cancellable,
  };
}

/** FR-16: guest-initiated cancel within the configured window (03 cancel + 06 refund policy). */
export async function cancelWebBooking(reservationId: string): Promise<{ status: string; refundPaise: number }> {
  const prisma = bookingDb();
  const r = await prisma.reservation.findFirst({
    where: { id: reservationId },
    select: { id: true, code: true, status: true, propertyId: true, checkInDate: true, advancePaise: true, allocations: { select: { roomId: true } } },
  });
  if (!r) throw new NotFoundError("Booking not found.");
  if (r.status !== "CONFIRMED" && r.status !== "ENQUIRY") throw new DomainError(ErrorCode.ILLEGAL_TRANSITION);

  const cfg = await prisma.bookingEngineConfig.findUnique({ where: { propertyId: r.propertyId }, select: { cancelWindowHours: true } });
  const hoursToCheckIn = (r.checkInDate.getTime() - Date.now()) / 3_600_000;
  if (hoursToCheckIn < (cfg?.cancelWindowHours ?? 48)) {
    throw new DomainError(ErrorCode.STAY_CONSTRAINT_VIOLATION, "Outside the free-cancellation window.", { publicMessage: "This booking can no longer be cancelled online." });
  }
  const property = await prisma.property.findUniqueOrThrow({ where: { id: r.propertyId }, select: { orgId: true } });

  await withBookingSystemContext(property.orgId, () =>
    prisma.$transaction(async (tx) => {
      const roomIds = r.allocations.map((a) => a.roomId);
      await tx.roomAllocation.deleteMany({ where: { reservationId: r.id } });
      await tx.reservation.updateMany({ where: { id: r.id }, data: { status: "CANCELLED", holdExpiresAt: null } });
      if (roomIds.length) {
        await tx.room.updateMany({ where: { id: { in: roomIds } }, data: { status: "VACANT" } });
        for (const roomId of roomIds) {
          await emitEvent(tx, { type: "RoomStatusChanged", aggregateId: roomId, propertyId: r.propertyId, payload: { to: "VACANT", reason: "web-cancel" } });
        }
      }
      await emitEvent(tx, { type: "WebBookingCancelled", aggregateId: r.id, propertyId: r.propertyId, payload: { code: r.code, refundPaise: r.advancePaise } });
      await writeAudit(tx, { action: "bookingengine:cancel", entityType: "Reservation", entityId: r.id, propertyId: r.propertyId, reason: "guest self-service cancel within window", after: { status: "CANCELLED", refundPaise: r.advancePaise } });
    }),
  );
  // Advance refund is 06's policy at folio level for a confirmed booking; the
  // gateway refund of an advance is triggered off WebBookingCancelled by 06/12.
  return { status: "CANCELLED", refundPaise: r.advancePaise };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Retry a booking tx once on a serialization failure; map the exclusion
 *  constraint (overbooking refused) to ROOM_UNAVAILABLE — mirrors 03. */
async function runBooking<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (e) {
      const code = e instanceof Prisma.PrismaClientKnownRequestError ? (e.meta as { code?: string } | undefined)?.code : undefined;
      const msg = e instanceof Error ? e.message : "";
      if (code === "23P01" || msg.includes("room_no_overlap")) throw new DomainError(ErrorCode.ROOM_UNAVAILABLE);
      if (attempt === 0 && (code === "40001" || code === "40P01")) continue;
      throw e;
    }
  }
}

function parseCouponCode(notes: string | null): string | null {
  return parseNote(notes, "couponCode");
}
function parseCategoryId(notes: string | null): string | null {
  return parseNote(notes, "roomCategoryId");
}
function parseNote(notes: string | null, key: "couponCode" | "roomCategoryId"): string | null {
  if (!notes) return null;
  try {
    const parsed = JSON.parse(notes) as Record<string, string | undefined>;
    return parsed[key] ?? null;
  } catch {
    return null;
  }
}

type Tx = Prisma.TransactionClient;

/** Redeem a coupon once under a row lock — mirrors 06 applyCoupon; swallows
 *  COUPON_* so an invalid coupon at confirm never fails the booking (FR-24). */
async function tryRedeemCoupon(
  tx: Tx,
  ctx: { orgId: string; code: string; guestId: string; reservationId: string; folioId: string; propertyId: string; propertyState: string; bookingNetPaise: number },
): Promise<void> {
  try {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Coupon" WHERE "orgId" = ${ctx.orgId} AND "code" = ${ctx.code} FOR UPDATE`;
    if (!locked[0]) return;
    const coupon = (await tx.coupon.findUniqueOrThrow({ where: { id: locked[0].id } })) as CouponLike & {
      id: string; status: string; validFrom: Date; validTo: Date; usageLimit: number | null; usageLimitPerGuest: number; timesUsed: number;
    };
    const now = new Date();
    if (coupon.status !== "ACTIVE" || now < coupon.validFrom || now > coupon.validTo) return;
    if (coupon.usageLimit != null && coupon.timesUsed >= coupon.usageLimit) return;
    const guestUses = await tx.couponRedemption.count({ where: { couponId: coupon.id, guestId: ctx.guestId } });
    if (guestUses >= coupon.usageLimitPerGuest) return;

    // Discount is computed on the reservation's net (pre-tax) snapshot.
    const reservation = await tx.reservation.findFirstOrThrow({ where: { id: ctx.reservationId }, select: { ratePaise: true, nights: true, discountPaise: true } });
    const net = reservation.ratePaise * reservation.nights;
    const discount = reservation.discountPaise > 0 ? reservation.discountPaise : computeCouponDiscount(coupon, net);
    if (discount <= 0) return;

    await tx.coupon.updateMany({ where: { id: coupon.id }, data: { timesUsed: { increment: 1 } } });
    try {
      await tx.couponRedemption.create({ data: { couponId: coupon.id, guestId: ctx.guestId, reservationId: ctx.reservationId, folioId: ctx.folioId, discountPaise: discount } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return; // already redeemed for this reservation
      throw e;
    }

    const draft = discountLine(discount, 1200, ctx.propertyState, ctx.propertyState, "PRE_TAX");
    await tx.folioLine.create({
      data: {
        folioId: ctx.folioId, type: "DISCOUNT", description: `Coupon ${ctx.code}`, quantity: 1,
        unitPaise: draft.amountPaise, amountPaise: BigInt(draft.amountPaise), taxRateBps: draft.taxRateBps,
        cgstPaise: draft.cgstPaise, sgstPaise: draft.sgstPaise, igstPaise: draft.igstPaise,
        placeOfSupplyState: ctx.propertyState, businessDate: new Date(),
      },
    });
    await emitEvent(tx, { type: "CouponRedeemed", aggregateId: coupon.id, propertyId: ctx.propertyId, payload: { code: ctx.code, discountPaise: discount, folioId: ctx.folioId } });
  } catch (e) {
    logger.info("booking-engine.coupon_skip", { code: ctx.code, error: e instanceof Error ? e.message : String(e) });
  }
}

async function auditBotRejection(prisma: PrismaClient, cfg: PublishedConfig, ip: string): Promise<void> {
  await withBookingSystemContext(cfg.orgId, () =>
    prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        action: "bookingengine:bot-rejected", entityType: "BookingEngineConfig", entityId: cfg.configId,
        propertyId: cfg.propertyId, reason: "Bot/abuse signal", after: { ip },
      });
    }),
  );
}

export { loadPublishedConfig };
