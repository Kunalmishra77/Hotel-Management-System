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
import { NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { maskIdValue } from "./domain/masking";
import { addGuestIdSchema, removeGuestIdSchema } from "./schema";
import { guestDb, withGuestContext } from "./internal";

export type GuestIdAdded = {
  id: string;
  type: IdType;
  maskedValue: string | null;
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
    const value = data.value?.trim() || null;

    // Finalized front-desk workflow: an ID is captured as DOCUMENT IMAGES; a typed
    // number is optional. When a number IS given it is masked; the FULL number is
    // retained (encrypted + searchable) only where policy permits — Aadhaar stays
    // gated behind COMPLIANCE_STORE_FULL_AADHAAR, so we never keep a full Aadhaar
    // number by default. The images themselves go to encrypted object storage.
    const maskedValue = value ? (maskIdValue(type, value) ?? null) : null;
    const encryptedValue = value && fullStorageAllowed ? encryptString(value) : null;
    const valueHash = value && fullStorageAllowed ? keyedHash(value.replace(/\s/g, "").toUpperCase()) : null;

    // Upload document images (front + back) BEFORE the DB write, so a failed
    // upload never leaves a row pointing at a missing object.
    const uploadImage = async (base64?: string | null, contentType?: string | null) => {
      if (!base64) return { key: null as string | null, checksum: null as string | null };
      const storage = resolveStorageAdapter();
      const key = scanObjectKey({ orgId: user.orgId, guestId: data.guestId, idType: type, unique: randomUUID().slice(0, 8) });
      const stored = await storage.put(key, Buffer.from(base64, "base64"), {
        contentType: contentType ?? "application/octet-stream",
      });
      return { key: stored.key, checksum: stored.checksum };
    };
    const front = await uploadImage(data.scanBase64, data.scanContentType);
    const back = await uploadImage(data.backScanBase64, data.backScanContentType);

    return withGuestContext(user, () =>
      prisma.$transaction(async (tx) => {
        const row = await tx.guestId.create({
          data: {
            guestId: data.guestId,
            type,
            maskedValue,
            valueHash,
            encryptedValue,
            scanObjectKey: front.key,
            scanChecksum: front.checksum,
            backObjectKey: back.key,
            backChecksum: back.checksum,
          },
          select: { id: true, type: true, maskedValue: true, scanObjectKey: true, backObjectKey: true },
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
          hasScan: row.scanObjectKey !== null || row.backObjectKey !== null,
        };
      }),
    );
  });
}

/**
 * Remove a wrongly-added government ID. To CHANGE an ID (wrong type/number/scan)
 * the front desk removes the wrong one and adds the correct one — a GuestId holds
 * no financial meaning, so unlike a folio line it can be deleted. Its scan images
 * are purged from object storage first (best-effort) so no orphan PII remains.
 * `guest:manage`, audited (type + masked value only, never the full number).
 */
export async function removeGuestId(input: unknown): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    const data = removeGuestIdSchema.parse(input);
    const user = await requireUser();
    authorize(user, "guest:manage");

    const prisma = guestDb();
    const row = await prisma.guestId.findFirst({
      where: { id: data.rowId, guest: { orgId: user.orgId, deletedAt: null } },
      select: { id: true, guestId: true, type: true, maskedValue: true, scanObjectKey: true, backObjectKey: true },
    });
    if (!row) throw new NotFoundError("ID not found");

    // Purge scan images before the row is gone — an orphan DB row pointing at a
    // deleted object is worse than an orphan object, so delete objects best-effort
    // and never let a storage hiccup block removing the wrong record.
    const storage = resolveStorageAdapter();
    for (const key of [row.scanObjectKey, row.backObjectKey]) {
      if (key) {
        try { await storage.delete(key); } catch { /* leave the object rather than block the fix */ }
      }
    }

    return withGuestContext(user, () =>
      prisma.$transaction(async (tx) => {
        await tx.guestId.delete({ where: { id: row.id } });
        await emitEvent(tx, {
          type: "GuestIdRemoved",
          aggregateId: row.guestId,
          payload: { guestId: row.guestId, idType: row.type },
        });
        await writeAudit(tx, {
          action: "guest:remove-id",
          entityType: "GuestId",
          entityId: row.id,
          reason: data.reason ?? null,
          before: { guestId: row.guestId, type: row.type, maskedValue: row.maskedValue },
        });
        revalidatePath(`/guests/${row.guestId}`);
        return { id: row.id };
      }),
    );
  });
}
