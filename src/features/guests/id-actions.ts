"use server";

/**
 * Government IDs — 04 T-9 (FR-3/4/7, AC-4/5/6).
 *
 * The compliance core of the module:
 *  - Aadhaar is stored MASKED (last 4) by default; the full number or an Aadhaar
 *    scan is REJECTED unless `COMPLIANCE_STORE_FULL_AADHAAR` is on (FR-4). A
 *    guest is creatable without Aadhaar.
 *  - Other IDs may store the full value encrypted, plus a keyed `valueHash` for
 *    search-by-ID without decrypting (client §4).
 *  - Scans go to encrypted, India-region object storage; the row keeps only
 *    `scanObjectKey` + `scanChecksum`, never the bytes or the number (FR-7).
 */
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { IdType } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { encryptString, keyedHash } from "@/lib/crypto/encryption";
import { isFullAadhaarStorageEnabled } from "@/lib/constants/compliance";
import { resolveStorageAdapter, scanObjectKey } from "@/lib/storage";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { maskIdValue } from "./domain/masking";
import { addGuestIdSchema } from "./schema";
import { guestDb, withGuestContext } from "./internal";

export type GuestIdAdded = {
  id: string;
  type: IdType;
  maskedValue: string;
  hasScan: boolean;
};

export async function addGuestId(input: unknown): Promise<Result<GuestIdAdded>> {
  return toResult(async () => {
    const data = addGuestIdSchema.parse(input);
    const user = await requireUser();
    authorize(user, "guest:manage");

    const prisma = guestDb();
    const guest = await prisma.guest.findFirst({
      where: { id: data.guestId, orgId: user.orgId, deletedAt: null },
      select: { id: true },
    });
    if (!guest) throw new NotFoundError("Guest not found");

    const type = data.type as IdType;
    const fullStorageAllowed = type === "AADHAAR" ? isFullAadhaarStorageEnabled() : true;

    // FR-4 — reject an attempt to store a full Aadhaar or an Aadhaar scan while
    // full storage is off. This is a hard refusal, not a silent truncation, so
    // the caller knows the full number was NOT retained.
    if (type === "AADHAAR" && !fullStorageAllowed && data.scanBase64) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, "Aadhaar scan storage disabled", {
        publicMessage:
          "Storing an Aadhaar scan is disabled by policy. Only the last 4 digits are kept.",
        details: { code: "AADHAAR_FULL_STORAGE_DISABLED" },
      });
    }

    const maskedValue = maskIdValue(type, data.value) ?? "";

    // Full value + search token only when policy permits (always for non-Aadhaar,
    // Aadhaar only when the flag is on).
    const encryptedValue = fullStorageAllowed ? encryptString(data.value) : null;
    const valueHash = fullStorageAllowed
      ? keyedHash(data.value.replace(/\s/g, "").toUpperCase())
      : null;

    // Upload the scan (if any and allowed) BEFORE the DB write, so a failed
    // upload never leaves a row pointing at a missing object.
    let scanKey: string | null = null;
    let scanChecksum: string | null = null;
    if (data.scanBase64 && fullStorageAllowed) {
      const storage = resolveStorageAdapter();
      const key = scanObjectKey({
        orgId: user.orgId,
        guestId: data.guestId,
        idType: type,
        unique: randomUUID().slice(0, 8),
      });
      const stored = await storage.put(key, Buffer.from(data.scanBase64, "base64"), {
        contentType: data.scanContentType ?? "application/octet-stream",
      });
      scanKey = stored.key;
      scanChecksum = stored.checksum;
    }

    return withGuestContext(user, () =>
      prisma.$transaction(async (tx) => {
        const row = await tx.guestId.create({
          data: {
            guestId: data.guestId,
            type,
            maskedValue,
            valueHash,
            encryptedValue,
            scanObjectKey: scanKey,
            scanChecksum,
          },
          select: { id: true, type: true, maskedValue: true, scanObjectKey: true },
        });

        await emitEvent(tx, {
          type: "GuestIdAdded",
          aggregateId: data.guestId,
          payload: { guestId: data.guestId, idType: type },
        });
        await writeAudit(tx, {
          action: "guest:add-id",
          entityType: "GuestId",
          entityId: row.id,
          // Only the TYPE and masked value — never the full number.
          after: { guestId: data.guestId, type, maskedValue },
        });

        revalidatePath(`/guests/${data.guestId}`);
        return {
          id: row.id,
          type: row.type,
          maskedValue: row.maskedValue,
          hasScan: row.scanObjectKey !== null,
        };
      }),
    );
  });
}
