"use server";

/** Client-callable wrapper for the audit browser's filter + "load more". */
import { getAuditPage, type AuditFilters } from "./queries";
import type { AuditRow } from "./internal";

export async function fetchAuditPage(
  filters: AuditFilters,
  cursor?: string,
): Promise<{ rows: AuditRow[]; nextCursor: string | null }> {
  return getAuditPage(filters, cursor);
}
