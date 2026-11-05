"use server";

/**
 * The front desk's check-in (client, 5 Nov 2026): a booking needs only name,
 * mobile and address, but CHECK-IN requires the full guest record — mobile,
 * WhatsApp, gender, nationality, home address and a photo ID. Email and date of
 * birth may be skipped; they stay on the booking's pending card. Checked here on
 * the server from the guest row itself (not from what the wizard says), then the
 * normal `checkIn` runs. The go-live importer calls `checkIn` directly — imported
 * history carries whatever the source file had.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { checkIn, type LifecycleResult } from "./lifecycle-actions";
import { missingForCheckIn } from "./domain/guest-checklist";
import { reservationDb } from "./internal";
import { checkInSchema } from "./schema";

export async function completeCheckIn(input: unknown): Promise<Result<LifecycleResult>> {
  const gate = await toResult(async () => {
    const { reservationId } = checkInSchema.parse(input);
    const user = await requireUser();
    const r = await reservationDb(user).reservation.findFirst({
      where: { id: reservationId },
      select: {
        propertyId: true,
        guest: {
          select: {
            mobile: true, whatsapp: true, gender: true, nationality: true, addressLine: true, city: true, country: true,
            _count: { select: { ids: true } },
          },
        },
      },
    });
    if (!r) throw new NotFoundError("Reservation not found.");
    authorize(user, "checkin:perform", r.propertyId);

    const missing = missingForCheckIn({
      hasMobile: !!r.guest.mobile,
      hasWhatsapp: !!r.guest.whatsapp,
      gender: r.guest.gender,
      nationality: r.guest.nationality,
      addressLine: r.guest.addressLine,
      city: r.guest.city,
      country: r.guest.country,
      idCount: r.guest._count.ids,
    });
    if (missing.length > 0) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, "Guest details incomplete", {
        publicMessage: `Complete the guest details before check-in: ${missing.join(", ")}.`,
        details: { missing },
      });
    }
    return true;
  });
  if (!gate.ok) return gate;
  return checkIn(input);
}
