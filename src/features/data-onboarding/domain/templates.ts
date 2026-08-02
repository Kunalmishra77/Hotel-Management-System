/**
 * Import templates — 26 (FR-2, AC-1). One place that declares, per kind, the
 * canonical fields, their column headers, and an example row. Both `getTemplate`
 * (the download) and `autoMapping` (header→field resolution) read this, so the
 * template a user downloads maps back onto itself with zero manual mapping.
 */
import type { ImportKindName } from "./validate";

export type TemplateSpec = {
  /** Canonical field names — the keys `validateRow` reads. */
  fields: readonly string[];
  /** Human column headers (same order); default 1:1 with field names. */
  headers: readonly string[];
  /** One illustrative example row (same order as headers). */
  example: readonly string[];
};

export const TEMPLATES: Record<ImportKindName, TemplateSpec> = {
  GUESTS: {
    fields: ["fullName", "mobile", "email", "city", "state", "companyName", "gstNumber", "aadhaar"],
    headers: ["Full name", "Mobile", "Email", "City", "State", "Company", "GSTIN", "Aadhaar"],
    example: ["Ravi Kumar", "9876543210", "ravi@example.com", "Bengaluru", "Karnataka", "", "", ""],
  },
  RESERVATIONS: {
    fields: ["mobile", "checkInDate", "checkOutDate", "source", "categoryName", "roomNo", "amount", "externalRef"],
    headers: ["Guest mobile", "Check-in (YYYY-MM-DD)", "Check-out (YYYY-MM-DD)", "Source", "Room category", "Room no", "Amount (₹)", "External booking id"],
    example: ["9876543210", "2025-01-10", "2025-01-12", "DIRECT", "Deluxe", "", "8000", "LEGACY-1001"],
  },
  BALANCES: {
    fields: ["mobile", "amount"],
    headers: ["Guest mobile", "Outstanding amount (₹)"],
    example: ["9876543210", "1500"],
  },
  ROOMS: {
    fields: ["roomNo", "categoryName"],
    headers: ["Room no", "Room category"],
    example: ["101", "Deluxe"],
  },
  STAFF: {
    fields: ["fullName", "mobile"],
    headers: ["Full name", "Mobile"],
    example: ["Asha Rao", "9800000000"],
  },
};

/** Header → field mapping for a template's OWN headers (used by getTemplate + tests). */
export function templateMapping(kind: ImportKindName): Record<string, string> {
  const t = TEMPLATES[kind];
  const map: Record<string, string> = {};
  t.fields.forEach((field, i) => { map[field] = t.headers[i]!; });
  return map;
}

/** Render the downloadable template CSV (header row + one example row). */
export function templateCsv(kind: ImportKindName): string {
  const t = TEMPLATES[kind];
  const line = (cells: readonly string[]) =>
    cells.map((c) => (/[",\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",");
  return `${line(t.headers)}\r\n${line(t.example)}\r\n`;
}
