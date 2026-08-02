"use server";

/**
 * 15 T-6 — export (FR-4/5/6, AC-4/5/7/10). Canonical write path for an egress:
 * authorize `export:data`, gather the permitted+scoped result set, apply the PII
 * gate (`export:pii` → raw, else omitted), render CSV/Excel/PDF, store ENCRYPTED,
 * and record an `ExportJob` + `DataExported` event + audit. A set larger than the
 * async threshold is NOT rendered inline — a QUEUED `ExportJob` is created for a
 * worker to fulfil, and the caller gets the job id (FR-4/AC-10).
 */
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/auth";
import { authorize, hasPermission } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { toResult, type Result } from "@/lib/result";
import { resolveStorageAdapter } from "@/lib/storage";
import { db } from "@/lib/db";
import { decryptOptional } from "@/lib/crypto/encryption";
import { toExportRows, type ExportRow } from "./domain/export-rows";
import { renderExport, CONTENT_TYPE, type ExportFormat } from "./export-format";
import { search } from "./queries";
import { decodeCursor, encodeCursor } from "./domain/federate";
import { searchDb, withSearchContext } from "./internal";
import { exportSchema, unifiedSearchSchema } from "./schema";
import type { SearchResult, UnifiedSearchQuery } from "./types";
import type { SessionClaims } from "@/lib/auth/claims";

export type ExportResult = {
  jobId: string;
  status: "DONE" | "QUEUED";
  rowCount: number | null;
  includesPii: boolean;
  objectKey: string | null;
};

const MAX_EXPORT_ROWS = 50_000; // hard cap — never build an unbounded file (NFR).
const DEFAULT_ASYNC_THRESHOLD = 1_000;

/** Which fields are PII per entity (omitted unless export:pii). */
const PII_FIELDS: Record<string, string[]> = { guest: ["mobile", "email"], staff: ["mobile"] };

/** Page through unified search collecting up to `cap` rows (FR-4 gather). */
async function gather(user: SessionClaims, query: UnifiedSearchQuery, cap: number): Promise<SearchResult[]> {
  const out: SearchResult[] = [];
  let cursor = query.cursor;
  for (let guard = 0; guard < 10_000 && out.length <= cap; guard++) {
    const page = await search(user, { ...query, cursor, limit: 50 });
    out.push(...page.results);
    const done = Object.keys(page.nextCursor).length === 0 || page.results.length === 0;
    cursor = page.nextCursor;
    if (done) break;
  }
  return out.slice(0, cap + 1); // one extra to detect "over the threshold"
}

/** Build export rows, enriching raw PII values only when the caller may export PII. */
async function toRows(user: SessionClaims, results: SearchResult[], canPii: boolean): Promise<ExportRow[]> {
  const rawGuest = new Map<string, { mobile: string | null; email: string | null }>();
  const rawStaff = new Map<string, { mobile: string | null }>();
  if (canPii) {
    const guestIds = results.filter((r) => r.entity === "guest").map((r) => r.id);
    const staffIds = results.filter((r) => r.entity === "staff").map((r) => r.id);
    if (guestIds.length) {
      for (const g of await db.unscoped().guest.findMany({ where: { id: { in: guestIds }, orgId: user.orgId }, select: { id: true, mobile: true, email: true } })) {
        rawGuest.set(g.id, { mobile: decryptOptional(g.mobile), email: decryptOptional(g.email) });
      }
    }
    if (staffIds.length) {
      for (const s of await db.scoped(user).staff.findMany({ where: { id: { in: staffIds } }, select: { id: true, mobile: true } })) {
        rawStaff.set(s.id, { mobile: decryptOptional(s.mobile) });
      }
    }
  }

  return results.map((r) => {
    const piiFields = PII_FIELDS[r.entity] ?? [];
    const columns: ExportRow["columns"] = {};
    for (const [k, v] of Object.entries(r.fields)) {
      const isPii = piiFields.includes(k);
      let raw: string | number | null | undefined;
      if (isPii && canPii) {
        if (r.entity === "guest") raw = k === "mobile" ? maskOrRaw(rawGuest.get(r.id)?.mobile) : maskOrRaw(rawGuest.get(r.id)?.email);
        if (r.entity === "staff") raw = maskOrRaw(rawStaff.get(r.id)?.mobile);
      }
      columns[k] = { value: v, raw, pii: isPii };
    }
    return { entity: r.entity, id: r.id, columns };
  });
}
function maskOrRaw(v: string | null | undefined): string | null {
  return v ?? null;
}

/** Internal core so tests can force the async threshold. */
export async function runExport(
  user: SessionClaims,
  input: { keyword?: string; entities?: UnifiedSearchQuery["entities"]; filters?: UnifiedSearchQuery["filters"]; format: ExportFormat },
  asyncThreshold = DEFAULT_ASYNC_THRESHOLD,
): Promise<ExportResult> {
  authorize(user, "export:data", input.filters?.propertyId ?? null); // FR-6
  const canPii = hasPermission(user, "export:pii");
  const query: UnifiedSearchQuery = { keyword: input.keyword, entities: input.entities, filters: input.filters };

  const gathered = await gather(user, query, Math.min(asyncThreshold, MAX_EXPORT_ROWS));
  const tooLarge = gathered.length > asyncThreshold;
  const kind = (input.entities?.length ? input.entities.join("+") : "all");

  return withSearchContext(user, () =>
    searchDb().$transaction(async (tx) => {
      if (tooLarge) {
        // Don't build it inline — queue for a worker (FR-4/AC-10).
        const job = await tx.exportJob.create({
          data: { userId: user.userId, kind, format: input.format, filter: input.filters ?? {}, status: "QUEUED", includesPii: canPii, rowCount: null },
          select: { id: true },
        });
        await emitEvent(tx, { type: "DataExported", aggregateId: job.id, payload: { kind, format: input.format, status: "QUEUED", includesPii: canPii } });
        await writeAudit(tx, { action: canPii ? "export:pii" : "export:data", entityType: "ExportJob", entityId: job.id, after: { kind, format: input.format, status: "QUEUED", includesPii: canPii } });
        return { jobId: job.id, status: "QUEUED" as const, rowCount: null, includesPii: canPii, objectKey: null };
      }

      const rows = await toRows(user, gathered, canPii);
      const flat = toExportRows(rows, canPii);
      const bytes = await renderExport(input.format, flat, `Search export — ${kind}`);
      const objectKey = `exports/${user.orgId}/${randomUUID()}.${input.format}`;
      await resolveStorageAdapter().put(objectKey, bytes, { contentType: CONTENT_TYPE[input.format] });

      const job = await tx.exportJob.create({
        data: { userId: user.userId, kind, format: input.format, filter: input.filters ?? {}, status: "DONE", objectKey, rowCount: flat.length, includesPii: canPii },
        select: { id: true },
      });
      await emitEvent(tx, { type: "DataExported", aggregateId: job.id, payload: { kind, format: input.format, rowCount: flat.length, includesPii: canPii } });
      await writeAudit(tx, { action: canPii ? "export:pii" : "export:data", entityType: "ExportJob", entityId: job.id, after: { kind, format: input.format, rowCount: flat.length, includesPii: canPii } });
      return { jobId: job.id, status: "DONE" as const, rowCount: flat.length, includesPii: canPii, objectKey };
    }),
  );
}

/** Export a search result set (server action). */
export async function exportSearch(input: unknown): Promise<Result<ExportResult>> {
  return toResult(async () => {
    const data = exportSchema.parse(input);
    const user = await requireUser();
    return runExport(user, data);
  });
}

export type SearchActionResult = {
  results: (Omit<SearchResult, "sortAt"> & { sortAt: string })[];
  nextCursor: string | null;
};

/** Unified search (server action for the client search bar). Cursor is opaque. */
export async function searchAction(input: unknown): Promise<Result<SearchActionResult>> {
  return toResult(async () => {
    const data = unifiedSearchSchema.parse(input);
    const user = await requireUser();
    const page = await search(user, { ...data, cursor: decodeCursor(data.cursor) });
    return {
      results: page.results.map((r) => ({ ...r, sortAt: r.sortAt.toISOString() })),
      nextCursor: Object.keys(page.nextCursor).length ? encodeCursor(page.nextCursor) : null,
    };
  });
}
