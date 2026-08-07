"use server";

/**
 * Check-in artifacts — 03 T6. `saveRegistrationCard` persists the digital
 * registration card + e-signature captured during the check-in wizard. The
 * signature PNG is uploaded to ENCRYPTED object storage (PII, exactly like an ID
 * scan) — the row keeps only the object key + checksum, never the bytes. The
 * guest snapshot is built server-side from the reservation (authoritative), so a
 * tampered client payload cannot forge what the card records.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { resolveStorageAdapter } from "@/lib/storage";
import { getGuestProfile } from "@/features/guests/queries";
import { extractPassportFields, type PassportFields } from "@/features/ai/passport-extract";
import { reservationDb, withReservationContext } from "./internal";
import { saveRegistrationCardSchema, saveCFormSchema } from "./schema";
import { renderCForm } from "./cform";

export type RegistrationCardSaved = { id: string; hasSignature: boolean };

export async function saveRegistrationCard(input: unknown): Promise<Result<RegistrationCardSaved>> {
  return toResult(async () => {
    const data = saveRegistrationCardSchema.parse(input);
    const user = await requireUser();
    const client = reservationDb(user);

    const r = await client.reservation.findFirst({
      where: { id: data.reservationId },
      select: {
        id: true,
        propertyId: true,
        code: true,
        status: true,
        guestId: true,
        checkInDate: true,
        checkOutDate: true,
        nights: true,
        guest: { select: { fullName: true } },
        allocations: { select: { room: { select: { number: true } } } },
      },
    });
    if (!r) throw new NotFoundError("Reservation not found.");
    authorize(user, "checkin:perform", r.propertyId);

    // Captured at check-in — before the guest is checked out.
    if (r.status !== "CONFIRMED" && r.status !== "IN_HOUSE") {
      throw new DomainError(ErrorCode.ILLEGAL_TRANSITION, "The registration card is captured during check-in.");
    }

    // Signature → encrypted object storage; DB keeps only the reference (PII).
    let signatureObjectKey: string | null = null;
    let signatureChecksum: string | null = null;
    if (data.signatureBase64) {
      const bytes = Buffer.from(data.signatureBase64, "base64");
      const key = `registration-cards/${user.orgId}/${r.id}/signature-${randomUUID()}`;
      const stored = await resolveStorageAdapter().put(key, bytes, { contentType: "image/png" });
      signatureObjectKey = stored.key;
      signatureChecksum = stored.checksum;
    }

    // Freeze what the guest signed — masked IDs only (no PII beyond the card need).
    const profile = await getGuestProfile(user, r.guestId);
    const guestSnapshot = {
      guestName: r.guest.fullName,
      code: r.code,
      rooms: r.allocations.map((a) => a.room.number),
      checkInDate: r.checkInDate.toISOString().slice(0, 10),
      checkOutDate: r.checkOutDate.toISOString().slice(0, 10),
      nights: r.nights,
      ids: (profile?.ids ?? []).map((i) => ({ type: i.type, maskedValue: i.maskedValue })),
      capturedAt: new Date().toISOString(),
    };

    return withReservationContext(user, () =>
      client.$transaction(async (tx) => {
        const existing = await tx.registrationCard.findFirst({
          where: { reservationId: r.id },
          select: { id: true },
        });

        const card = existing
          ? await tx.registrationCard.update({
              where: { id: existing.id },
              data: { signatureObjectKey, signatureChecksum, keyCardRef: data.keyCardRef ?? null, guestSnapshot },
              select: { id: true },
            })
          : await tx.registrationCard.create({
              data: {
                propertyId: r.propertyId,
                reservationId: r.id,
                signatureObjectKey,
                signatureChecksum,
                keyCardRef: data.keyCardRef ?? null,
                guestSnapshot,
                capturedById: user.userId,
              },
              select: { id: true },
            });

        await emitEvent(tx, {
          type: "RegistrationCardCaptured",
          aggregateId: r.id,
          propertyId: r.propertyId,
          payload: { code: r.code, hasSignature: signatureObjectKey !== null },
        });
        await writeAudit(tx, {
          action: "reservation:registration-card",
          entityType: "RegistrationCard",
          entityId: card.id,
          propertyId: r.propertyId,
          after: { hasSignature: signatureObjectKey !== null, keyCard: data.keyCardRef ?? null },
        });

        return { id: card.id, hasSignature: signatureObjectKey !== null };
      }),
    );
  });
}

const ymd = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);

export type PassportExtractResult = PassportFields;

/**
 * Document-AI passport pre-fill for the Form C step (03 T7). Reads the guest's
 * passport scan reference and asks the AI layer to extract fields — deterministic
 * empties in the sandbox, so the wizard falls back to manual entry. The LLM never
 * writes anything; reception verifies before `saveCForm`.
 */
export async function extractPassportForCheckIn(input: unknown): Promise<Result<PassportExtractResult>> {
  return toResult(async () => {
    const { reservationId } = z.object({ reservationId: z.string().min(1) }).parse(input);
    const user = await requireUser();
    const client = reservationDb(user);
    const r = await client.reservation.findFirst({
      where: { id: reservationId },
      select: { propertyId: true, guestId: true },
    });
    if (!r) throw new NotFoundError("Reservation not found.");
    authorize(user, "checkin:perform", r.propertyId);

    const profile = await getGuestProfile(user, r.guestId);
    const passport = profile?.ids.find((i) => i.type === "PASSPORT");
    const context = passport?.hasScan
      ? `Passport document on file for ${profile?.fullName ?? "guest"}.`
      : "No passport scan on file.";
    return extractPassportFields(context);
  });
}

export type CFormSaved = { id: string; hasPdf: boolean };

/**
 * Save + generate a foreign guest's Form C (03 T7). Canonical write path; the
 * passport/visa NUMBERS are never persisted here (they live encrypted on GuestId)
 * — `details` stores a MASKED snapshot that also sources the PDF. The Form C PDF
 * renders to encrypted object storage after commit (payslip/invoice pattern).
 */
export async function saveCForm(input: unknown): Promise<Result<CFormSaved>> {
  return toResult(async () => {
    const data = saveCFormSchema.parse(input);
    const user = await requireUser();
    const client = reservationDb(user);

    const r = await client.reservation.findFirst({
      where: { id: data.reservationId },
      select: {
        id: true,
        propertyId: true,
        code: true,
        status: true,
        guestId: true,
        checkInDate: true,
        checkOutDate: true,
        guest: { select: { fullName: true } },
        property: { select: { name: true, addressLine1: true, city: true, state: true } },
      },
    });
    if (!r) throw new NotFoundError("Reservation not found.");
    authorize(user, "checkin:perform", r.propertyId);
    if (r.status !== "CONFIRMED" && r.status !== "IN_HOUSE") {
      throw new DomainError(ErrorCode.ILLEGAL_TRANSITION, "The Form C is captured during check-in.");
    }

    // Masked passport/visa from the guest's encrypted IDs — never the full number.
    const profile = await getGuestProfile(user, r.guestId);
    const passportMasked = profile?.ids.find((i) => i.type === "PASSPORT")?.maskedValue ?? null;
    const visaMasked = profile?.ids.find((i) => i.type === "VISA")?.maskedValue ?? null;

    const snapshot = {
      guestName: r.guest.fullName,
      nationality: data.nationality,
      passportMasked,
      visaMasked,
      passportPlaceOfIssue: data.passportPlaceOfIssue ?? null,
      passportIssueDate: ymd(data.passportIssueDate),
      passportExpiryDate: ymd(data.passportExpiryDate),
      visaType: data.visaType ?? null,
      visaIssueDate: ymd(data.visaIssueDate),
      visaExpiryDate: ymd(data.visaExpiryDate),
      arrivalFromCity: data.arrivalFromCity ?? null,
      arrivalFromCountry: data.arrivalFromCountry ?? null,
      arrivalInIndiaDate: ymd(data.arrivalInIndiaDate),
      nextDestination: data.nextDestination ?? null,
      purposeOfVisit: data.purposeOfVisit ?? null,
      capturedAt: new Date().toISOString(),
    };

    const cformId = await withReservationContext(user, () =>
      client.$transaction(async (tx) => {
        const existing = await tx.cForm.findFirst({ where: { reservationId: r.id }, select: { id: true } });
        const common = {
          nationality: data.nationality,
          passportPlaceOfIssue: data.passportPlaceOfIssue ?? null,
          passportIssueDate: data.passportIssueDate ?? null,
          passportExpiryDate: data.passportExpiryDate ?? null,
          visaType: data.visaType ?? null,
          visaIssueDate: data.visaIssueDate ?? null,
          visaExpiryDate: data.visaExpiryDate ?? null,
          arrivalFromCity: data.arrivalFromCity ?? null,
          arrivalFromCountry: data.arrivalFromCountry ?? null,
          arrivalInIndiaDate: data.arrivalInIndiaDate ?? null,
          nextDestination: data.nextDestination ?? null,
          purposeOfVisit: data.purposeOfVisit ?? null,
          details: snapshot,
        };
        const rec = existing
          ? await tx.cForm.update({ where: { id: existing.id }, data: common, select: { id: true } })
          : await tx.cForm.create({
              data: { propertyId: r.propertyId, reservationId: r.id, guestId: r.guestId, capturedById: user.userId, ...common },
              select: { id: true },
            });
        await emitEvent(tx, {
          type: "CFormGenerated",
          aggregateId: r.id,
          propertyId: r.propertyId,
          payload: { code: r.code, nationality: data.nationality },
        });
        await writeAudit(tx, {
          action: "reservation:cform",
          entityType: "CForm",
          entityId: rec.id,
          propertyId: r.propertyId,
          after: { nationality: data.nationality },
        });
        return rec.id;
      }),
    );

    // Render + store the Form C PDF after commit (encrypted storage; DB keeps the key).
    const pdf = await renderCForm({
      propertyName: r.property.name,
      propertyAddress: [r.property.addressLine1, r.property.city, r.property.state].filter(Boolean).join(", "),
      guestName: r.guest.fullName,
      nationality: data.nationality,
      passportNumberMasked: passportMasked,
      passportPlaceOfIssue: data.passportPlaceOfIssue ?? null,
      passportIssueDate: ymd(data.passportIssueDate),
      passportExpiryDate: ymd(data.passportExpiryDate),
      visaNumberMasked: visaMasked,
      visaType: data.visaType ?? null,
      visaIssueDate: ymd(data.visaIssueDate),
      visaExpiryDate: ymd(data.visaExpiryDate),
      arrivalFromCity: data.arrivalFromCity ?? null,
      arrivalFromCountry: data.arrivalFromCountry ?? null,
      arrivalInIndiaDate: ymd(data.arrivalInIndiaDate),
      arrivalAtHotelDate: ymd(r.checkInDate) ?? "",
      departureDate: ymd(r.checkOutDate) ?? "",
      nextDestination: data.nextDestination ?? null,
      purposeOfVisit: data.purposeOfVisit ?? null,
      generatedAt: new Date().toISOString().slice(0, 10),
    });
    const key = `cforms/${user.orgId}/${r.id}.pdf`;
    const stored = await resolveStorageAdapter().put(key, pdf, { contentType: "application/pdf" });
    await client.cForm.update({ where: { id: cformId }, data: { pdfObjectKey: stored.key } });

    return { id: cformId, hasPdf: true };
  });
}
