"use server";

/**
 * Historical / current stay import (go-live data entry). The client backfills
 * their guest book so history, occupancy and revenue are complete from day one.
 * In one audited transaction it creates a reservation + folio + per-night room
 * charge + any extra charges (meals/laundry/…) + optional payment tied to the
 * chosen property and dates — the same money path as a live stay.
 *
 * Status follows the dates against the property's local today:
 *   check-out in the past  → CHECKED_OUT (invoiced now)
 *   still staying          → IN_HOUSE (no invoice yet; room posts up to today)
 *   check-in in the future → CONFIRMED (no room posted yet)
 *
 * GST mode (inclusive/exclusive) says whether the rate/charges the staff type
 * already include GST or add it on top. It does NOT run the live availability
 * engine: it picks a room free for the range and allocates it; if none is free the
 * stay is still recorded (dates + folio) without a hard allocation.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { db } from "@/lib/db";
import { emitEvent } from "@/lib/events";
import { writeAudit } from "@/lib/audit";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { revalidatePath } from "next/cache";
import { ensureFolio, postRoomChargeTx, postServiceChargeTx, postPaymentTx, autoIssueInvoiceOnCheckout, type BillingPostTx } from "@/features/billing";
import { roomGstBps, gstBpsForCharge } from "@/lib/constants/gst";
import { recomputeHistoricalSnapshot } from "@/features/analytics/night-audit";
import { createGuest } from "@/features/guests/actions";
import { addGuestId } from "@/features/guests/id-actions";
import { mobileToken } from "@/features/guests/internal";
import { normalizePhone } from "@/features/guests/domain/normalize";
import { reservationDb, withReservationContext, generateReservationCode, overlapWhere } from "./internal";
import { historicalStaySchema } from "./schema";

export type ReturningGuest = { id: string; fullName: string; city: string | null; country: string | null; lastStay: string | null };

/**
 * Find existing guests matching a name or mobile, so the Data Entry form can offer
 * a returning guest for one-click reuse (no duplicate record). Returns only
 * non-sensitive fields (name/city/country + last stay date) — never the masked
 * contact, and no PII reveal. Requires reservation:create on the active property.
 */
export async function searchGuestsForEntry(query: string): Promise<Result<ReturningGuest[]>> {
  return toResult(async () => {
    const q = (query ?? "").trim();
    const user = await requireUser();
    authorize(user, "reservation:create", user.activePropertyId);
    if (q.length < 2) return [];

    const phone = normalizePhone(q);
    const hash = phone ? mobileToken(phone) : null;
    const rows = await db.unscoped().guest.findMany({
      where: {
        orgId: user.orgId,
        deletedAt: null,
        OR: [
          { fullName: { contains: q, mode: "insensitive" } },
          ...(hash ? [{ mobileHash: hash }] : []),
        ],
      },
      select: {
        id: true, fullName: true, city: true, country: true,
        reservations: { select: { checkOutDate: true }, orderBy: { checkOutDate: "desc" }, take: 1 },
      },
      orderBy: { fullName: "asc" },
      take: 6,
    });
    return rows.map((g) => ({
      id: g.id,
      fullName: g.fullName,
      city: g.city,
      country: g.country,
      lastStay: g.reservations[0]?.checkOutDate.toISOString().slice(0, 10) ?? null,
    }));
  });
}

const at = (date: Date, hour: number) => new Date(date.getTime() + hour * 3_600_000);

export async function createHistoricalStay(input: unknown): Promise<Result<{ reservationId: string; guestId: string }>> {
  return toResult(async () => {
    const data = historicalStaySchema.parse(input);
    const user = await requireUser();
    authorize(user, "reservation:create", data.propertyId);

    const property = await reservationDb(user).property.findFirst({
      where: { id: data.propertyId, deletedAt: null },
      select: { id: true, state: true, timezone: true },
    });
    if (!property) throw new NotFoundError("Property not found.");

    // 1. Guest — a returning guest is REUSED (no duplicate); otherwise create one.
    let guestId: string;
    if (data.guestId) {
      const existing = await db.unscoped().guest.findFirst({
        where: { id: data.guestId, orgId: user.orgId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("Selected guest not found.");
      guestId = existing.id;
    } else {
      const guest = await createGuest({
        fullName: data.fullName,
        mobile: data.mobile,
        email: data.email ?? undefined,
        gender: data.gender ?? undefined,
        nationality: data.nationality ?? undefined,
        addressLine: data.address ?? undefined,
        city: data.city ?? undefined,
        country: data.country ?? undefined,
        dob: data.dob ?? undefined,
        confirmDuplicate: true,
      });
      if (!guest.ok) {
        // Surface the specific field problem (e.g. "Enter a valid mobile number")
        // instead of the generic "check the highlighted fields" so the staff know
        // exactly what to correct on this backfill row.
        const firstFieldError = guest.error.fieldErrors
          ? Object.values(guest.error.fieldErrors)[0]?.[0]
          : undefined;
        const msg = firstFieldError ?? guest.error.message;
        throw new DomainError(ErrorCode.VALIDATION_FAILED, msg, { publicMessage: msg });
      }
      guestId = guest.data.id;
    }

    // 2. ID documents — one per person sharing the room. Legacy single-ID fields
    //    are still honoured; the form now sends the `ids` array. Sequential so a
    //    few uploads don't burst the connection pool.
    if (data.idType && (data.idNumber || data.scanBase64)) {
      await addGuestId({
        guestId,
        type: data.idType,
        value: data.idNumber ?? undefined,
        scanBase64: data.scanBase64 ?? undefined,
        scanContentType: data.scanContentType ?? undefined,
      });
    }
    for (const idDoc of data.ids) {
      if (idDoc.value || idDoc.scanBase64) {
        await addGuestId({
          guestId,
          type: idDoc.type,
          value: idDoc.value ?? undefined,
          scanBase64: idDoc.scanBase64 ?? undefined,
          scanContentType: idDoc.scanContentType ?? undefined,
        });
      }
    }

    // 3. Dates → nights.
    const ci = new Date(`${data.checkInDate}T00:00:00.000Z`);
    const co = new Date(`${data.checkOutDate}T00:00:00.000Z`);
    const dayMs = 86_400_000;
    const nights = Math.max(1, Math.round((co.getTime() - ci.getTime()) / dayMs));
    const nightDates: Date[] = [];
    for (let i = 0; i < nights; i++) nightDates.push(new Date(ci.getTime() + i * dayMs));
    const ratePaise = data.ratePaise ?? 0;
    // Payments: the `payments` array (multiple, each with a method/date/ref), plus
    // the legacy single "amount collected" (posted as one CASH payment).
    const legacyPaid = data.amountPaidPaise ?? 0;
    const amountPaid = legacyPaid + data.payments.reduce((s, p) => s + p.amountPaise, 0);

    // Property-local "today" (calendar date). Decides the reservation status and
    // which nights are already consumed (only those post now; the night audit
    // handles future nights of a still-staying guest — its partial-unique index
    // makes a same-date re-post a no-op, so there is no double count).
    const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: property.timezone });
    const todayDate = new Date(`${todayStr}T00:00:00.000Z`);
    const status: "CHECKED_OUT" | "IN_HOUSE" | "CONFIRMED" =
      data.checkOutDate <= todayStr ? "CHECKED_OUT" : data.checkInDate > todayStr ? "CONFIRMED" : "IN_HOUSE";
    const postableNights = nightDates.filter((d) => d.getTime() <= todayDate.getTime());

    // GST mode: "inclusive" → the entered amount is the all-in price the guest
    // paid; back out the taxable value at the applicable band so taxable + GST
    // equals what was typed (a paid stay settles to ₹0). "exclusive" → the amount
    // is pre-tax and GST is added on top (like a live booking).
    const toTaxable = (amountPaise: number, bps: number): number =>
      data.gstMode === "exclusive" ? amountPaise : Math.round((amountPaise * 10_000) / (10_000 + bps));
    const roomBps = ratePaise > 0 ? roomGstBps(ratePaise) : 0;
    const taxableRatePaise = ratePaise > 0 ? toTaxable(ratePaise, roomBps) : 0;
    const extraCharges = data.extraCharges.map((c) => ({
      type: c.type,
      description: c.description ?? null,
      taxablePaise: toTaxable(c.amountPaise, gstBpsForCharge(c.type)),
    }));
    const hasBill = ratePaise > 0 || amountPaid > 0 || extraCharges.length > 0;

    // 4. The room: the one the staff picked, else a room free for the range.
    //    Occupancy needs an allocation, but only if the room is actually free for
    //    the dates — checked up-front so a clash can't poison the transaction.
    const room = data.roomId
      ? await reservationDb(user).room.findFirst({
          where: { id: data.roomId, propertyId: data.propertyId, isActive: true },
          select: { id: true, number: true },
        })
      : await reservationDb(user).room.findFirst({
          where: { propertyId: data.propertyId, isActive: true, allocations: { none: overlapWhere(ci, co) } },
          select: { id: true, number: true },
        });
    let allocate = false;
    if (room) {
      const clash = await reservationDb(user).roomAllocation.findFirst({
        where: { roomId: room.id, ...overlapWhere(ci, co) },
        select: { id: true },
      });
      allocate = !clash;
    }

    const code = generateReservationCode();

    const result = await withReservationContext(user, () =>
      reservationDb(user).$transaction(async (tx) => {
        const reservation = await tx.reservation.create({
          data: {
            propertyId: data.propertyId,
            code,
            guestId,
            status,
            source: data.source,
            settlementIntent: amountPaid > 0 ? "ALREADY_PAID" : "PAY_AT_HOTEL",
            checkInDate: ci,
            checkOutDate: co,
            // Timestamps match the lifecycle: a future booking isn't checked in;
            // a still-staying guest has no check-out yet.
            checkInAt: status === "CONFIRMED" ? null : at(ci, 14),
            checkOutAt: status === "CHECKED_OUT" ? at(co, 11) : null,
            nights,
            adults: 1 + data.accompanyingGuests.length,
            children: 0,
            // Tariff is stored pre-tax (glossary): the taxable rate the night audit
            // also adds GST to, so a still-staying guest's future nights match.
            ratePaise: taxableRatePaise,
            taxPaise: 0, // the folio carries the authoritative tax
            advancePaise: 0,
          },
          select: { id: true },
        });

        if (room && allocate) {
          await tx.roomAllocation.create({
            data: { propertyId: data.propertyId, reservationId: reservation.id, roomId: room.id, startDate: ci, endDate: co },
          });
        }

        // Accompanying guests — same room + same bill, each with their own details.
        if (data.accompanyingGuests.length > 0) {
          await tx.reservationGuest.createMany({
            data: data.accompanyingGuests.map((ag) => ({
              propertyId: data.propertyId,
              reservationId: reservation.id,
              fullName: ag.fullName,
              age: ag.age ?? null,
              gender: ag.gender ?? null,
              relation: ag.relation ?? null,
              idType: ag.idType ?? null,
              idNumber: ag.idNumber ?? null,
            })),
          });
        }

        // Folio + one ROOM line per consumed night + extra charges + payment.
        if (hasBill) {
          const folioId = await ensureFolio(tx, { reservationId: reservation.id, propertyId: data.propertyId });
          if (taxableRatePaise > 0) {
            for (const businessDate of postableNights) {
              await postRoomChargeTx(tx as unknown as BillingPostTx, {
                folioId,
                propertyId: data.propertyId,
                propertyState: property.state,
                ratePaise: taxableRatePaise,
                businessDate,
                postedById: user.userId,
                description: `Room ${room?.number ?? ""} · night`.trim(),
              });
            }
          }
          // Extra services (meals, laundry, cab…) — on the same folio + bill, dated
          // to the stay (clamped to today so they land in current revenue).
          if (extraCharges.length > 0) {
            const extrasDate = ci.getTime() <= todayDate.getTime() ? ci : todayDate;
            for (const c of extraCharges) {
              await postServiceChargeTx(tx as unknown as BillingPostTx, {
                folioId,
                propertyId: data.propertyId,
                propertyState: property.state,
                type: c.type,
                description: c.description,
                amountPaise: c.taxablePaise,
                businessDate: extrasDate,
                postedById: user.userId,
              });
            }
          }
          // Payments — the legacy single "amount collected" (as CASH), then each
          // recorded payment with its own method / reference / date.
          if (legacyPaid > 0) {
            await postPaymentTx(tx as unknown as BillingPostTx, {
              folioId,
              propertyId: data.propertyId,
              mode: "CASH",
              amountPaise: legacyPaid,
              reference: `HIST-${code}`,
              receivedById: user.userId,
            });
          }
          for (const p of data.payments) {
            await postPaymentTx(tx as unknown as BillingPostTx, {
              folioId,
              propertyId: data.propertyId,
              mode: p.mode,
              amountPaise: p.amountPaise,
              reference: p.reference ?? `HIST-${code}`,
              receivedById: user.userId,
              receivedAt: p.receivedAt ? new Date(`${p.receivedAt}T12:00:00.000Z`) : null,
            });
          }
        }

        await emitEvent(tx, {
          type: "ReservationCreated",
          aggregateId: reservation.id,
          propertyId: data.propertyId,
          payload: { code, historical: true },
        });
        await writeAudit(tx, {
          action: "reservation:historical-import",
          entityType: "Reservation",
          entityId: reservation.id,
          propertyId: data.propertyId,
          after: { code, guestId, checkInDate: data.checkInDate, checkOutDate: data.checkOutDate, nights },
        });
        return { reservationId: reservation.id, guestId };
      }),
    );

    // Mandatory bill: raise the statutory GST invoice once the stay is complete
    // (checked out). A still-staying (IN_HOUSE) or future (CONFIRMED) guest is not
    // invoiced yet — that happens at their real check-out. Best-effort + idempotent.
    if (status === "CHECKED_OUT" && hasBill) {
      // Skip the inline PDF render — it is CPU-heavy and, on a run of bulk entries,
      // stalled the next request enough to bounce staff to the login screen. The
      // invoice row is created now; its PDF renders on first download.
      await autoIssueInvoiceOnCheckout(result.reservationId, { renderPdf: false });
    }

    // Backfill each consumed night's stats snapshot so the stay shows in occupancy,
    // ADR, RevPAR and the revenue trend/property league — not just the money KPIs.
    // Best-effort: the stay + folio are already committed; a snapshot hiccup must
    // not fail the import (the nightly audit would rebuild it anyway).
    if (room && allocate) {
      for (const businessDate of postableNights) {
        try {
          await recomputeHistoricalSnapshot(data.propertyId, businessDate);
        } catch {
          // Non-fatal — occupancy/ADR just lag until the next audit for that date.
        }
      }
    }

    revalidatePath("/guests");
    revalidatePath("/bookings");
    revalidatePath("/billing");
    revalidatePath("/overview");
    revalidatePath("/insights");
    return result;
  });
}
