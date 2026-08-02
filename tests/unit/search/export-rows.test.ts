/**
 * 15 T-4 — toExportRows PII gate (FR-5, AC-5/AC-10).
 */
import { describe, expect, it } from "vitest";
import { exportHeaders, toExportRows, type ExportRow } from "@/features/search/domain/export-rows";

const rows: ExportRow[] = [
  {
    entity: "guest",
    id: "g1",
    columns: {
      name: { value: "Ravi Kumar" },
      mobile: { value: "98XXXXXX01", raw: "9800000001", pii: true },
      email: { value: "r***@x.com", raw: "ravi@x.com", pii: true },
      city: { value: "Bangalore" },
    },
  },
];

describe("toExportRows", () => {
  it("OMITS pii columns entirely when the caller lacks export:pii (U-REC)", () => {
    const out = toExportRows(rows, false);
    expect(out[0]).toEqual({ entity: "guest", id: "g1", name: "Ravi Kumar", city: "Bangalore" });
    expect(out[0]).not.toHaveProperty("mobile");
    expect(out[0]).not.toHaveProperty("email");
  });

  it("emits RAW pii values when the caller holds export:pii (U-ACC)", () => {
    const out = toExportRows(rows, true);
    expect(out[0]!.mobile).toBe("9800000001");
    expect(out[0]!.email).toBe("ravi@x.com");
    expect(out[0]!.name).toBe("Ravi Kumar");
  });

  it("falls back to the masked value if no raw was gathered", () => {
    const out = toExportRows(
      [{ entity: "guest", id: "g2", columns: { mobile: { value: "98XXXXXX02", pii: true } } }],
      true,
    );
    expect(out[0]!.mobile).toBe("98XXXXXX02");
  });

  it("exportHeaders is the stable union of non-omitted columns", () => {
    expect(exportHeaders(toExportRows(rows, false))).toEqual(["entity", "id", "name", "city"]);
    expect(exportHeaders(toExportRows(rows, true))).toEqual(["entity", "id", "name", "mobile", "email", "city"]);
  });
});
