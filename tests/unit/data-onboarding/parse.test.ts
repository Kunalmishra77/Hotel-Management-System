/** 26 T-3 — parseFile CSV + Excel → typed rows, mapping applied (FR-2). */
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { readCsv, parseFile, rowsFromTable, autoMapping } from "@/features/data-onboarding/domain/parse";
import { TEMPLATES } from "@/features/data-onboarding/domain/templates";

const GUEST_FIELDS = TEMPLATES.GUESTS.fields;

describe("readCsv (RFC-4180)", () => {
  it("handles quoted fields with embedded commas, quotes and newlines", () => {
    const csv = 'a,b\n"x,y","he said ""hi""",\n"multi\nline",z\n';
    const table = readCsv(csv);
    expect(table[0]).toEqual(["a", "b"]);
    expect(table[1]![0]).toBe("x,y");
    expect(table[1]![1]).toBe('he said "hi"');
    expect(table[2]![0]).toBe("multi\nline");
  });

  it("strips a UTF-8 BOM from the first header", () => {
    const table = readCsv("﻿Full name,Mobile\nAsha,9800000101\n");
    expect(table[0]![0]).toBe("Full name");
  });
});

describe("parseFile + autoMapping (CSV)", () => {
  it("maps template headers to canonical fields and numbers data rows from 1", async () => {
    const csv = "Full name,Mobile,Email\nAsha Rao,9800000101,asha@example.com\n\nVikram,9800000102,\n";
    const mapping = autoMapping(["Full name", "Mobile", "Email"], GUEST_FIELDS);
    const rows = await parseFile(Buffer.from(csv, "utf8"), "csv", mapping);
    // blank line skipped; two data rows
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ rowNum: 1, raw: { fullName: "Asha Rao", mobile: "9800000101", email: "asha@example.com" } });
    expect(rows[1]!.rowNum).toBe(3); // preserves original file line index
    expect(rows[1]!.raw.email).toBe("");
  });

  it("throws when no mapped column is present in the header", () => {
    expect(() => rowsFromTable([["Nope"], ["x"]], { fullName: "Full name" })).toThrow();
  });
});

describe("parseFile (Excel, streamed reader)", () => {
  it("reads the first worksheet into mapped rows", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Guests");
    ws.addRow(["Full name", "Mobile"]);
    ws.addRow(["Asha Rao", "9800000101"]);
    ws.addRow(["Vikram Nair", "9800000102"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const mapping = autoMapping(["Full name", "Mobile"], GUEST_FIELDS);
    const rows = await parseFile(buf, "xlsx", mapping);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.raw.fullName).toBe("Asha Rao");
    expect(rows[1]!.raw.mobile).toBe("9800000102");
  });
});
