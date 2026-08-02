"use server";

/**
 * DPDP right-to-erasure — 04 T-13 (FR-14, AC-13/AC-14).
 *
 * Scrubs personal fields AND clears the keyed search/PII tokens
 * (`mobileHash`/`emailHash`/every `GuestId.valueHash`+`encryptedValue`), purges
 * scans from storage, and soft-deletes — so the record is no longer searchable
 * or recoverable. Financial records (folios/invoices) are preserved in
 * anonymized-but-linked form: they reference the guest id, which survives.
 *
 * REJECTS while the guest has an active ENQUIRY/CONFIRMED/IN_HOUSE reservation
 * (AC-14) — you cannot erase someone mid-stay.
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { resolveStorageAdapter } from "@/lib/storage";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { guestActionSchema } from "./schema";
import { guestDb, withGuestContext } from "./internal";

/** Reservation statuses that block erasure (FR-14). */
const ACTIVE_RESERVATION_STATUSES = ["ENQUIRY", "CONFIRMED", "IN_HOUSE"] as const;

export async function eraseGuest(input: unknown): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    const data = guestActionSchema.parse(input);
    const user = await requireUser();
    authorize(user, "guest:delete", null, { reason: data.reason ?? "DPDP erasure request" });

    const prisma = guestDb();
    const guest = await prisma.guest.findFirst({
      where: { id: data.guestId, orgId: user.orgId, deletedAt: null },
      select: { id: true },
    });
    if (!guest) throw new NotFoundError("Guest not found");

    const activeReservations = await prisma.reservation.count({
      where: { guestId: guest.id, status: { in: [...ACTIVE_RESERVATION_STATUSES] } },
    });
    if (activeReservations > 0) {
      throw new DomainError(ErrorCode.CONFLICT, "Guest has an active reservation", {
        publicMessage:
          "This guest has an active reservation. Close the stay before erasing their data.",
        details: { code: "ERASE_BLOCKED_ACTIVE_STAY" },
      });
    }

    // Purge scans BEFORE the DB write — the object keys are lost once the rows
    // are scrubbed, so this must happen while we still have them.
    const idRows = await prisma.guestId.findMany({
      where: { guestId: guest.id },
      select: { scanObjectKey: true },
    });
    const storage = resolveStorageAdapter();
    for (const row of idRows) {
      if (row.scanObjectKey) {
        // A missing object is fine — the goal is that it is gone.
        await storage.delete(row.scanObjectKey).catch(() => {});
      }
    }

    return withGuestContext(user, () =>
      prisma.$transaction(async (tx) => {
        await tx.guest.update({
          where: { id: guest.id },
          data: {
            fullName: "[erased]",
            gender: null,
            dob: null,
            anniversary: null,
            nationality: null,
            occupation: null,
            // `mobile` is a required column, so it is scrubbed to a marker
            // rather than nulled; `mobileHash` (nullable) is cleared so the
            // erased guest is no longer discoverable by number.
            mobile: "[erased]",
            mobileHash: null,
            whatsapp: null,
            email: null,
            emailHash: null,
            addressLine: null,
            city: null,
            state: null,
            country: null,
            pincode: null,
            companyName: null,
            gstNumber: null,
            purposeOfVisit: null,
            specialRequests: null,
            foodPreference: null,
            medicalNotes: null,
            preferredFloor: null,
            deletedAt: new Date(),
          },
        });

        // Clear each ID row's searchable/recoverable tokens; keep the row shell
        // so financial links that reference it stay valid.
        await tx.guestId.updateMany({
          where: { guestId: guest.id },
          data: {
            valueHash: null,
            encryptedValue: null,
            scanObjectKey: null,
            scanChecksum: null,
            maskedValue: "[erased]",
          },
        });

        await emitEvent(tx, {
          type: "GuestErased",
          aggregateId: guest.id,
          payload: { guestId: guest.id },
        });
        await writeAudit(tx, {
          action: "guest:erase",
          entityType: "Guest",
          entityId: guest.id,
          reason: data.reason ?? null,
          after: { erased: true },
        });

        revalidatePath("/guests");
        return { id: guest.id };
      }),
    );
  });
}
