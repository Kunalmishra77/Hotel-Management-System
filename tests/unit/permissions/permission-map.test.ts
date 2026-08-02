/**
 * Traceability: 00 AC-10/AC-11 (FR-10/11/13).
 *
 * The point of this file is drift detection. `lib/permissions/permission-map.ts`
 * claims to be a transcription of docs/architecture/rbac-matrix.md; here we
 * re-parse that markdown and assert cell-for-cell equality. If someone edits
 * the doc without the code (or vice versa) this fails instead of silently
 * granting or denying the wrong thing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUDITED_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_MATRIX,
  PERMISSION_MAP,
} from "@/lib/permissions/permission-map";

type Grant = "allow" | "audited";
type ParsedRow = { permission: string; cells: Partial<Record<string, Grant>> };

const COLUMN_ROLES = [
  "ADMINISTRATOR",
  "MANAGER",
  "RECEPTION",
  "ACCOUNTS",
  "HOUSEKEEPING",
  "MAINTENANCE",
] as const;

function parseMatrixDoc(): ParsedRow[] {
  const md = readFileSync(
    join(process.cwd(), "docs", "architecture", "rbac-matrix.md"),
    "utf8",
  );
  const rows: ParsedRow[] = [];

  for (const line of md.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length !== 7) continue;
    const permission = cells[0] ?? "";
    // Skip the header row and the |---|:--:| separator.
    if (!permission.includes(":")) continue;

    const parsed: ParsedRow = { permission, cells: {} };
    COLUMN_ROLES.forEach((role, i) => {
      const cell = cells[i + 1] ?? "";
      if (cell === "✔") parsed.cells[role] = "allow";
      else if (cell === "🔒") parsed.cells[role] = "audited";
      else if (cell !== "") throw new Error(`Unexpected cell "${cell}" for ${permission}/${role}`);
    });
    rows.push(parsed);
  }
  return rows;
}

describe("PERMISSION_MAP ↔ rbac-matrix.md", () => {
  const doc = parseMatrixDoc();

  it("parses a non-trivial matrix from the doc", () => {
    expect(doc.length).toBeGreaterThan(40);
  });

  it("covers exactly the same permissions as the doc", () => {
    expect([...PERMISSIONS].sort()).toEqual(doc.map((r) => r.permission).sort());
  });

  it("matches the doc cell-for-cell", () => {
    for (const row of doc) {
      const coded = PERMISSION_MATRIX[row.permission as (typeof PERMISSIONS)[number]];
      expect(coded, `missing coded row for ${row.permission}`).toBeDefined();
      for (const role of COLUMN_ROLES) {
        expect(
          coded[role],
          `${row.permission} / ${role} disagrees with rbac-matrix.md`,
        ).toBe(row.cells[role]);
      }
    }
  });

  it("marks a permission audited when any role's cell is 🔒", () => {
    const expected = doc
      .filter((r) => Object.values(r.cells).includes("audited"))
      .map((r) => r.permission)
      .sort();
    expect([...AUDITED_PERMISSIONS].sort()).toEqual(expected);
  });
});

describe("PERMISSION_MAP shape", () => {
  it("gives Administrator every permission (rbac-matrix.md preamble)", () => {
    // "Admin has all permissions across all properties."
    expect([...PERMISSION_MAP.ADMINISTRATOR].sort()).toEqual([...PERMISSIONS].sort());
  });

  it("never grants housekeeping or maintenance a financial or PII permission", () => {
    // user-roles.md: least privilege — they see operational status only.
    const forbidden = [
      "folio:view",
      "folio:charge",
      "report:view-financial",
      "guest:view-pii",
      "payment:record",
      "invoice:generate",
    ] as const;
    for (const p of forbidden) {
      expect(PERMISSION_MAP.HOUSEKEEPING.has(p), `HOUSEKEEPING must not hold ${p}`).toBe(false);
      expect(PERMISSION_MAP.MAINTENANCE.has(p), `MAINTENANCE must not hold ${p}`).toBe(false);
    }
  });

  it("denies by default — Reception holds no user/integration administration", () => {
    expect(PERMISSION_MAP.RECEPTION.has("user:manage")).toBe(false);
    expect(PERMISSION_MAP.RECEPTION.has("integration:manage")).toBe(false);
    expect(PERMISSION_MAP.RECEPTION.has("expense:approve")).toBe(false);
  });
});
