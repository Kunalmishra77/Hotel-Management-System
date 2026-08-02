/**
 * `parseFile` — 26 T-3 (FR-2). CSV + Excel → typed rows, applying the column
 * mapping. CSV is tokenised row-by-row (bounded memory); Excel is read via
 * exceljs. A very large file is processed off the request path by the pg-boss
 * job (job.ts), so the front desk never blocks (NFR).
 *
 * Pure-ish: no DB, no context. It turns bytes + a header→field mapping into
 * `ParsedRow[]` whose `raw` preserves the ORIGINAL cell strings (FR-2) keyed by
 * the CANONICAL field name, ready for `validateRow`.
 */
import ExcelJS from "exceljs";

export type FileFormat = "csv" | "xlsx";
/** canonical field name → source column header in the uploaded file. */
export type Mapping = Record<string, string>;
export type ParsedRow = { rowNum: number; raw: Record<string, string> };

export class FileParseError extends Error {}

export function detectFormat(fileName: string): FileFormat {
  return /\.xlsx?$/i.test(fileName) ? "xlsx" : "csv";
}

/**
 * Auto-map a file's headers to canonical fields by case/space-insensitive name
 * match, so a file downloaded from `getTemplate` needs no manual mapping and a
 * test can skip the mapping UI. Unmapped canonical fields simply stay absent.
 */
export function autoMapping(headers: readonly string[], fields: readonly string[]): Mapping {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const byNorm = new Map(headers.map((h) => [norm(h), h]));
  const mapping: Mapping = {};
  for (const field of fields) {
    const hit = byNorm.get(norm(field));
    if (hit) mapping[field] = hit;
  }
  return mapping;
}

/**
 * Map a file's headers → canonical fields using a template's (headers, fields)
 * pairing. The file carries the DESCRIPTIVE labels ("Guest mobile", "Outstanding
 * amount (₹)"), which do NOT equal the field keys ("mobile", "amount") — so we
 * match the file header against the template's label and emit the paired field.
 * Norm strips spaces, punctuation and the ₹ sign so labels compare cleanly.
 */
export function autoMappingForTemplate(
  fileHeaders: readonly string[],
  templateHeaders: readonly string[],
  templateFields: readonly string[],
): Mapping {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_()₹/-]+/g, "");
  const byNorm = new Map(fileHeaders.map((h) => [norm(h), h]));
  const mapping: Mapping = {};
  templateHeaders.forEach((label, i) => {
    const field = templateFields[i];
    if (!field) return;
    const hit = byNorm.get(norm(label));
    if (hit) mapping[field] = hit;
  });
  return mapping;
}

/** Read the raw cell table (header row + data rows) from bytes — streamed for xlsx. */
export async function readTable(bytes: Buffer, format: FileFormat): Promise<string[][]> {
  return format === "xlsx" ? readXlsx(bytes) : readCsv(bytes.toString("utf8"));
}

/** Turn a raw table + mapping into ParsedRows keyed by canonical field name. */
export function rowsFromTable(table: string[][], mapping: Mapping): ParsedRow[] {
  if (table.length === 0) return [];
  const header = table[0]!.map((h) => h.trim());
  const colIndex = new Map(header.map((h, i) => [h, i] as const));

  const fieldCols: [string, number][] = [];
  for (const [field, sourceHeader] of Object.entries(mapping)) {
    const idx = colIndex.get(sourceHeader.trim());
    if (idx !== undefined) fieldCols.push([field, idx]);
  }
  if (fieldCols.length === 0) {
    throw new FileParseError("None of the mapped columns were found in the file's header row.");
  }

  const rows: ParsedRow[] = [];
  for (let r = 1; r < table.length; r++) {
    const cells = table[r]!;
    if (cells.every((c) => c.trim() === "")) continue; // skip blank lines
    const raw: Record<string, string> = {};
    for (const [field, idx] of fieldCols) raw[field] = (cells[idx] ?? "").trim();
    rows.push({ rowNum: r, raw }); // 1-based data row number (header is row 0)
  }
  return rows;
}

export async function parseFile(
  bytes: Buffer,
  format: FileFormat,
  mapping: Mapping,
): Promise<ParsedRow[]> {
  const table = await readTable(bytes, format);
  return rowsFromTable(table, mapping);
}

// --- CSV (RFC-4180) ---------------------------------------------------------
/** Tokenise CSV honouring quoted fields with embedded commas/quotes/newlines. */
export function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const src = text.replace(/^﻿/, ""); // strip BOM

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch === "\r") { /* swallow; \n closes the row */ }
    else field += ch;
  }
  // Flush a trailing field/row with no closing newline.
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// --- XLSX --------------------------------------------------------------------
async function readXlsx(bytes: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes as unknown as Parameters<typeof wb.xlsx.load>[0]);
  } catch (e) {
    throw new FileParseError(`Could not read the Excel file: ${(e as Error).message}`);
  }
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const table: string[][] = [];
  // includeEmpty keeps row positions aligned with the sheet so data-row numbers
  // match the file (a blank row becomes all-"" and is dropped by rowsFromTable).
  ws.eachRow({ includeEmpty: true }, (row) => {
    const values = row.values as unknown[]; // 1-indexed (index 0 is undefined)
    const cells: string[] = [];
    for (let i = 1; i < values.length; i++) cells.push(cellToString(values[i]));
    table.push(cells);
  });
  return table;
}

function cellToString(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const rich = v as { text?: string; result?: unknown; hyperlink?: string };
    if (typeof rich.text === "string") return rich.text;
    if (rich.result != null) return String(rich.result);
  }
  return String(v);
}
