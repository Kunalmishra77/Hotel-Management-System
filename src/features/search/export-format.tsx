/**
 * 15 — export file renderers (FR-4). CSV streamed-string, Excel via exceljs, PDF
 * via @react-pdf/renderer. All take the already-PII-gated flat rows so no writer
 * can leak a column the caller wasn't permitted (the gate is `toExportRows`).
 */
import ExcelJS from "exceljs";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { exportHeaders, type FlatRow } from "./domain/export-rows";

export type ExportFormat = "csv" | "xlsx" | "pdf";

export const CONTENT_TYPE: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

function cell(v: FlatRow[string] | undefined): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

/** RFC-4180 CSV — quote fields containing comma/quote/newline; double embedded quotes. */
function csvField(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: FlatRow[]): Buffer {
  const headers = exportHeaders(rows);
  const lines = [headers.map(csvField).join(",")];
  for (const row of rows) lines.push(headers.map((h) => csvField(cell(row[h]))).join(","));
  return Buffer.from(lines.join("\r\n"), "utf8");
}

export async function toXlsx(rows: FlatRow[], sheetName = "Export"): Promise<Buffer> {
  const headers = exportHeaders(rows);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(headers);
  for (const row of rows) ws.addRow(headers.map((h) => row[h] ?? null));
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

const styles = StyleSheet.create({
  page: { padding: 24, fontSize: 8 },
  title: { fontSize: 12, marginBottom: 8 },
  row: { flexDirection: "row", borderBottom: 1, borderColor: "#ddd", paddingVertical: 2 },
  head: { flexDirection: "row", borderBottom: 1.5, borderColor: "#333", paddingVertical: 2, fontWeight: "bold" },
  cell: { flex: 1, paddingHorizontal: 2 },
});

export async function toPdf(rows: FlatRow[], title = "Search export"): Promise<Buffer> {
  const headers = exportHeaders(rows);
  const doc = (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.head}>
          {headers.map((h) => (
            <Text key={h} style={styles.cell}>{h}</Text>
          ))}
        </View>
        {rows.map((row, i) => (
          <View key={i} style={styles.row} wrap={false}>
            {headers.map((h) => (
              <Text key={h} style={styles.cell}>{cell(row[h])}</Text>
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
  return renderToBuffer(doc);
}

export async function renderExport(format: ExportFormat, rows: FlatRow[], title: string): Promise<Buffer> {
  switch (format) {
    case "csv":
      return toCsv(rows);
    case "xlsx":
      return toXlsx(rows);
    case "pdf":
      return toPdf(rows, title);
  }
}
