"use server";

/**
 * 27 owner-portal — document vault writes (FR-6/7/8). Bytes go to ENCRYPTED
 * object storage (reuse the adapter); the row keeps only key + checksum +
 * metadata. Both staff (owner:manage) and the owner (owner:upload-docs) can
 * upload; an owner may delete only documents they uploaded. Every write audits.
 */
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/auth";
import { authorize, can } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { resolveStorageAdapter } from "@/lib/storage";
import type { SessionClaims } from "@/lib/auth/claims";
import { ownerDb, withOwnerContext, actorRole } from "./internal";
import { uploadOwnerDocumentSchema, deleteOwnerDocumentSchema } from "./schema";

/** Staff-manager (owner:manage) OR the owner (owner:upload-docs), property-scoped. */
function authorizeVaultWrite(user: SessionClaims, propertyId: string): void {
  if (can(user, "owner:manage", propertyId)) return;
  authorize(user, "owner:upload-docs", propertyId);
}

export type OwnerDocumentSaved = { id: string; title: string };

export async function uploadOwnerDocument(input: unknown): Promise<Result<OwnerDocumentSaved>> {
  return toResult(async () => {
    const data = uploadOwnerDocumentSchema.parse(input);
    const user = await requireUser();
    authorizeVaultWrite(user, data.propertyId);

    const bytes = Buffer.from(data.fileBase64, "base64");
    const key = `owner-docs/${user.orgId}/${data.propertyId}/${randomUUID()}`;
    const stored = await resolveStorageAdapter().put(key, bytes, { contentType: data.contentType });

    return withOwnerContext(user, () =>
      ownerDb(user).$transaction(async (tx) => {
        const doc = await tx.propertyDocument.create({
          data: {
            propertyId: data.propertyId,
            category: data.category,
            title: data.title,
            objectKey: stored.key,
            checksum: stored.checksum,
            sizeBytes: bytes.length,
            contentType: data.contentType,
            uploadedById: user.userId,
            uploadedByRole: actorRole(user),
          },
          select: { id: true, title: true },
        });
        await emitEvent(tx, {
          type: "PropertyDocumentUploaded",
          aggregateId: doc.id,
          propertyId: data.propertyId,
          payload: { title: doc.title, category: data.category },
        });
        await writeAudit(tx, {
          action: "owner:document-upload",
          entityType: "PropertyDocument",
          entityId: doc.id,
          propertyId: data.propertyId,
          after: { title: doc.title, category: data.category, role: actorRole(user) },
        });
        return doc;
      }),
    );
  });
}

export async function deleteOwnerDocument(input: unknown): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    const { documentId } = deleteOwnerDocumentSchema.parse(input);
    const user = await requireUser();

    const doc = await ownerDb(user).propertyDocument.findFirst({
      where: { id: documentId, deletedAt: null },
      select: { id: true, propertyId: true, uploadedById: true, uploadedByRole: true },
    });
    if (!doc) throw new NotFoundError("Document not found.");

    // Staff-managers may delete any in-scope document; an owner may delete only a
    // document they uploaded themselves — never a staff-uploaded one (AC-9).
    if (!can(user, "owner:manage", doc.propertyId)) {
      authorize(user, "owner:upload-docs", doc.propertyId);
      if (doc.uploadedByRole !== "OWNER" || doc.uploadedById !== user.userId) {
        throw new ForbiddenError("You can only delete documents you uploaded.");
      }
    }

    return withOwnerContext(user, () =>
      ownerDb(user).$transaction(async (tx) => {
        await tx.propertyDocument.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });
        await emitEvent(tx, {
          type: "PropertyDocumentDeleted",
          aggregateId: doc.id,
          propertyId: doc.propertyId,
          payload: {},
        });
        await writeAudit(tx, {
          action: "owner:document-delete",
          entityType: "PropertyDocument",
          entityId: doc.id,
          propertyId: doc.propertyId,
          before: { uploadedByRole: doc.uploadedByRole },
        });
        return { id: doc.id };
      }),
    );
  });
}
