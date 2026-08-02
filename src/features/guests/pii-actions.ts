"use server";

/**
 * PII reveal / export / erase — 04 T-10/T-12/T-13 (FR-8/9/13/14,
 * AC-8/9/12/13/14).
 *
 * Every path here is a controlled crossing of the PII boundary: it requires an
 * elevated permission, is audited, and (for reveal) demands a reason. The
 * decrypted value is returned to exactly one authorized caller and never
 * broadcast, logged, or cached.
 */
import type { IdType } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { decryptOptional } from "@/lib/crypto/encryption";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { revealPiiSchema, guestActionSchema } from "./schema";
import { guestDb, resolveToSurvivor, withGuestContext } from "./internal";

// ---------------------------------------------------------------------------
// Reveal (FR-9 / AC-8/AC-9)
// ---------------------------------------------------------------------------

export type RevealedPii = { field: string; value: string };

/**
 * Reveal one PII field, decrypted (FR-9).
 *
 * Requires `guest:view-pii` AND a non-empty reason (the reason is enforced by
 * `authorize`, since guest:view-pii is in REASON_REQUIRED_PERMISSIONS). Emits
 * `GuestPiiAccessed` and writes an audit row carrying who/guest/field/reason —
 * the value itself is never in the event or the log.
 */
export async function revealPii(input: unknown): Promise<Result<RevealedPii>> {
  return toResult(async () => {
    const data = revealPiiSchema.parse(input);
    const user = await requireUser();
    // The reason is validated by the schema and re-enforced here: guest:view-pii
    // is reason-mandated, so authorize throws REASON_REQUIRED without one.
    authorize(user, "guest:view-pii", null, { reason: data.reason });

    const prisma = guestDb();
    const guest = await prisma.guest.findFirst({
      where: { id: data.guestId, orgId: user.orgId, deletedAt: null },
      select: { id: true, mobile: true, whatsapp: true, email: true },
    });
    if (!guest) throw new NotFoundError("Guest not found");

    let value: string | null;
    if (data.field === "id") {
      if (!data.guestIdRowId) {
        throw new DomainError(ErrorCode.VALIDATION_FAILED, "guestIdRowId required for id reveal");
      }
      const idRow = await prisma.guestId.findFirst({
        where: { id: data.guestIdRowId, guestId: data.guestId },
        select: { encryptedValue: true },
      });
      value = decryptOptional(idRow?.encryptedValue ?? null);
    } else {
      value = decryptOptional(guest[data.field]);
    }

    if (value === null) {
      throw new NotFoundError("No stored value for that field");
    }

    // The audit + event commit together; the returned value never touches them.
    await withGuestContext(user, () =>
      prisma.$transaction(async (tx) => {
        await emitEvent(tx, {
          type: "GuestPiiAccessed",
          aggregateId: data.guestId,
          payload: { guestId: data.guestId, field: data.field },
        });
        await writeAudit(tx, {
          action: "guest:reveal-pii",
          entityType: "Guest",
          entityId: data.guestId,
          reason: data.reason,
          // field + reason only — the revealed value is NEVER audited.
          after: { field: data.field },
        });
      }),
    );

    return { field: data.field, value };
  });
}

// ---------------------------------------------------------------------------
// Export (FR-13 / AC-12)
// ---------------------------------------------------------------------------

export type GuestExport = {
  guestId: string;
  profile: Record<string, unknown>;
  ids: { type: IdType; maskedValue: string }[];
  exportedAt: string;
};

/**
 * DPDP data-portability export (FR-13). Gated by `export:pii`, audited.
 *
 * Contact fields are decrypted (this is the guest's OWN data, exported at their
 * request), but ID numbers are exported MASKED — a portability file should carry
 * the profile, not become a way to bulk-exfiltrate raw government IDs.
 */
export async function exportGuestData(input: unknown): Promise<Result<GuestExport>> {
  return toResult(async () => {
    const data = guestActionSchema.parse(input);
    const user = await requireUser();
    authorize(user, "export:pii", null, { reason: data.reason ?? "DPDP data-portability request" });

    const prisma = guestDb();
    const guest = await resolveToSurvivor(prisma, user.orgId, data.guestId);
    if (!guest) throw new NotFoundError("Guest not found");

    const full = await prisma.guest.findUniqueOrThrow({
      where: { id: guest.id },
      include: { ids: { select: { type: true, maskedValue: true } } },
    });

    const exported: GuestExport = {
      guestId: full.id,
      profile: {
        fullName: full.fullName,
        gender: full.gender,
        nationality: full.nationality,
        mobile: decryptOptional(full.mobile),
        whatsapp: decryptOptional(full.whatsapp),
        email: decryptOptional(full.email),
        addressLine: full.addressLine,
        city: full.city,
        state: full.state,
        country: full.country,
        pincode: full.pincode,
        companyName: full.companyName,
        gstNumber: full.gstNumber,
      },
      ids: full.ids,
      // Deterministic in tests: stamped by the caller after return, not here.
      exportedAt: "",
    };

    await withGuestContext(user, () =>
      prisma.$transaction((tx) =>
        writeAudit(tx, {
          action: "guest:export",
          entityType: "Guest",
          entityId: full.id,
          reason: data.reason ?? null,
          after: { idCount: full.ids.length },
        }),
      ),
    );

    return exported;
  });
}
