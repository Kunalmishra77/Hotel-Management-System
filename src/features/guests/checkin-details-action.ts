"use server";

/**
 * Save the guest details collected at check-in (client, 5 Nov 2026) — gender,
 * nationality, home address, WhatsApp (usually "same as mobile"), and email / date
 * of birth when the guest gives them. Validated server-side: the mandatory fields
 * can't be skipped by a crafted request. `guest:manage`, audited, GuestUpdated.
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { emitEvent } from "@/lib/events";
import { writeAudit } from "@/lib/audit";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { checkInDetailsSchema } from "./schema";
import { contactColumns, guestDb, withGuestContext } from "./internal";

export async function saveCheckInDetails(input: unknown): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    const d = checkInDetailsSchema.parse(input);
    const user = await requireUser();
    authorize(user, "guest:manage");
    const prisma = guestDb();

    return withGuestContext(user, () =>
      prisma.$transaction(async (tx) => {
        const g = await tx.guest.findFirst({
          where: { id: d.guestId, orgId: user.orgId, deletedAt: null },
          select: { id: true, mobile: true, whatsapp: true },
        });
        if (!g) throw new NotFoundError("Guest not found");

        const newMobile = d.mobile || undefined;
        // WhatsApp: same as the (new or existing) mobile, a typed number, or the one
        // already on file. Same-as-mobile with no new number copies the stored
        // ciphertext — the number is never decrypted for this.
        const whatsappCols = d.whatsappSameAsMobile
          ? (newMobile ? contactColumns({ whatsapp: newMobile }) : { whatsapp: g.mobile })
          : d.whatsapp
            ? contactColumns({ whatsapp: d.whatsapp })
            : {};
        if (!d.whatsappSameAsMobile && !d.whatsapp && !g.whatsapp) {
          throw new DomainError(ErrorCode.VALIDATION_FAILED, "WhatsApp missing", { publicMessage: "WhatsApp number is required." });
        }

        await tx.guest.update({
          where: { id: g.id },
          data: {
            gender: d.gender,
            nationality: d.nationality,
            addressLine: d.addressLine,
            city: d.city,
            state: d.state ?? null,
            pincode: d.pincode ?? null,
            country: d.country,
            // Optional: only set when given — never clear a value already on file.
            ...(d.dob ? { dob: new Date(d.dob) } : {}),
            ...contactColumns({ ...(newMobile ? { mobile: newMobile } : {}), ...(d.email ? { email: d.email } : {}) }),
            ...whatsappCols,
          },
        });

        await emitEvent(tx, { type: "GuestUpdated", aggregateId: g.id, payload: { guestId: g.id } });
        await writeAudit(tx, {
          action: "guest:update",
          entityType: "Guest",
          entityId: g.id,
          reason: "Check-in details",
          // Field names only — no PII values in the audit snapshot.
          after: { changed: ["gender", "nationality", "address", "whatsapp", ...(newMobile ? ["mobile"] : []), ...(d.email ? ["email"] : []), ...(d.dob ? ["dob"] : [])] },
        });
        revalidatePath(`/guests/${g.id}`);
        return { id: g.id };
      }),
    );
  });
}
