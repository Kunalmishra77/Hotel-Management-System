"use server";

/**
 * Data-onboarding server actions — 26 T-7/T-8/T-10/T-11/T-15 (FR-1..8/10/11).
 * Admin-only (`data:import`, 🔒). Canonical path: zod.parse → requireUser →
 * authorize → work → event/audit → typed Result. NO foreign INSERTs — all target
 * creation runs through 04/03/06 in the commit core.
 *
 * Dry-run (`validateBatch`) is side-effect-free: it writes NO target records.
 * Commit is idempotent (re-run creates nothing new). Large files are handed to a
 * pg-boss job so the request never blocks (job.ts + worker registration).
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { assertPropertyInScope } from "@/lib/db";
import { resolveStorageAdapter } from "@/lib/storage";
import { toResult, type Result } from "@/lib/result";
import { detectFormat, readTable, rowsFromTable, autoMappingForTemplate, type Mapping } from "./domain/parse";
import { maskAadhaar } from "./domain/normalize";
import { TEMPLATES } from "./domain/templates";
import type { ImportKindName } from "./domain/validate";
import { runValidation } from "./validate-core";
import { runCommit, assertCommittable, type CommitSummary } from "./commit-core";
import { runRollback, type RollbackSummary } from "./rollback-core";
import { IMPORT_INLINE_LIMIT, importDb, loadBatch, withImportContext } from "./internal";
import { enqueueImportJob, JOBS_IMPORT } from "./job";
import {
  createBatchSchema,
  validateBatchSchema,
  commitBatchSchema,
  rollbackBatchSchema,
} from "./schema";

export type CreateBatchResult = { batchId: string; rowCount: number; mapping: Mapping };
export type ValidateResult =
  | { queued: true; batchId: string }
  | { queued: false; okCount: number; errorCount: number; duplicateCount: number };
export type CommitResult = ({ queued: true; batchId: string }) | ({ queued: false } & CommitSummary);

/** Upload → store file → DRAFT batch + ImportRows (raw). (FR-1/2, AC-2) */
export async function createBatch(input: unknown): Promise<Result<CreateBatchResult>> {
  return toResult(async () => {
    const data = createBatchSchema.parse(input);
    const user = await requireUser();
    authorize(user, "data:import", data.propertyId ?? null);

    const kind = data.kind as ImportKindName;
    const bytes = Buffer.from(data.fileBase64, "base64");
    const format = detectFormat(data.fileName);

    // Parse to a raw table first so we can auto-map from headers when no mapping
    // was supplied (a template download maps back onto itself).
    const table = await readTable(bytes, format);
    const headers = table[0] ?? [];
    const tmpl = TEMPLATES[kind];
    const mapping: Mapping =
      data.mapping ?? autoMappingForTemplate(headers, tmpl.headers ?? tmpl.fields, tmpl.fields);
    const parsed = rowsFromTable(table, mapping);

    // Aadhaar is masked to last-4 BEFORE it is persisted to `ImportRow.raw` — the
    // full number never lands in the DB (compliance.md, AC-14). The original file
    // stays only in encrypted, access-controlled, purgeable object storage.
    const rows = parsed.map((r) =>
      r.raw.aadhaar ? { ...r, raw: { ...r.raw, aadhaar: maskAadhaar(r.raw.aadhaar) ?? "" } } : r,
    );

    // Store the source in encrypted, access-controlled object storage BEFORE the
    // rows — the DB keeps only the key (compliance.md; Aadhaar bytes never in DB).
    const fileObjectKey = `imports/${user.orgId}/${randomUUID()}`;
    await resolveStorageAdapter().put(fileObjectKey, bytes, { contentType: "application/octet-stream" });

    const db = importDb();
    const batchId = await withImportContext(user, () =>
      db.$transaction(async (tx) => {
        const batch = await tx.importBatch.create({
          data: {
            orgId: user.orgId,
            propertyId: data.propertyId ?? null,
            kind: data.kind,
            status: "DRAFT",
            fileObjectKey,
            mapping: mapping as Prisma.InputJsonValue,
            rowCount: rows.length,
            createdById: user.userId,
          },
          select: { id: true },
        });
        if (rows.length > 0) {
          await tx.importRow.createMany({
            data: rows.map((r) => ({
              batchId: batch.id,
              rowNum: r.rowNum,
              raw: r.raw as Prisma.InputJsonValue,
            })),
          });
        }
        await writeAudit(tx, {
          action: "data:import-create",
          entityType: "ImportBatch",
          entityId: batch.id,
          propertyId: data.propertyId ?? null,
          // rowCount only — no cell values (PII) in the audit row.
          after: { kind: data.kind, rowCount: rows.length },
        });
        return batch.id;
      }),
    );

    return { batchId, rowCount: rows.length, mapping };
  });
}

/** Dry-run validation — classify + counts + VALIDATED. Writes NO targets. (FR-3, AC-4/5) */
export async function validateBatch(input: unknown): Promise<Result<ValidateResult>> {
  return toResult(async () => {
    const { batchId } = validateBatchSchema.parse(input);
    const user = await requireUser();
    const batch = await loadBatch(user.orgId, batchId);
    authorize(user, "data:import", batch.propertyId);

    if (batch.rowCount > IMPORT_INLINE_LIMIT) {
      await enqueueImportJob(JOBS_IMPORT.validate, { batchId: batch.id, userId: user.userId });
      return { queued: true, batchId: batch.id };
    }
    const counts = await runValidation(user, batch);
    return { queued: false, ...counts };
  });
}

/** Commit a VALIDATED batch via 04/03/06 — idempotent, audited. (FR-4/5/6, AC-7/8) */
export async function commitBatch(input: unknown): Promise<Result<CommitResult>> {
  return toResult(async () => {
    const { batchId } = commitBatchSchema.parse(input);
    const user = await requireUser();
    const batch = await loadBatch(user.orgId, batchId);
    authorize(user, "data:import", batch.propertyId);
    assertCommittable(batch); // reject DRAFT / un-resolved errors up front (AC-8)

    if (batch.rowCount > IMPORT_INLINE_LIMIT) {
      await enqueueImportJob(JOBS_IMPORT.commit, { batchId: batch.id, userId: user.userId });
      return { queued: true, batchId: batch.id };
    }
    const summary = await runCommit(user, batch);
    return { queued: false, ...summary };
  });
}

/** Roll back: discard (uncommitted) or soft-void created targets (committed). (FR-8, AC-12) */
export async function rollbackBatch(input: unknown): Promise<Result<RollbackSummary>> {
  return toResult(async () => {
    const { batchId, reason } = rollbackBatchSchema.parse(input);
    const user = await requireUser();
    const batch = await loadBatch(user.orgId, batchId);
    authorize(user, "data:import", batch.propertyId);
    // A property-scoped batch must be inside the caller's scope (defence-in-depth
    // over the unscoped import client).
    if (batch.propertyId) assertPropertyInScope(user, batch.propertyId);
    return runRollback(user, batch, reason ?? null);
  });
}

export type { CommitSummary, RollbackSummary };
