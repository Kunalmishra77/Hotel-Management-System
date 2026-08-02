/** 13 T-3 — mapRoomType incl. missing mapping (FR-4/7, AC-2/6). Pure. */
import { describe, expect, it } from "vitest";
import { mapRoomType, normalizeExternalType } from "@/features/channels/domain/map-room-type";

const mappings = [
  { externalRoomType: "DLX-BB", roomCategoryId: "cat_dlx" },
  { externalRoomType: "STE-EP", roomCategoryId: "cat_ste", externalRatePlan: "EP" },
];

describe("mapRoomType (AC-2)", () => {
  it("resolves a mapped external type to its internal category", () => {
    expect(mapRoomType(mappings, "DLX-BB")).toBe("cat_dlx");
    expect(mapRoomType(mappings, "STE-EP")).toBe("cat_ste");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(mapRoomType(mappings, "  dlx-bb ")).toBe("cat_dlx");
    expect(normalizeExternalType(" dlx-bb ")).toBe("DLX-BB");
  });

  it("returns null for an unmapped external type (AC-6 — never guess)", () => {
    expect(mapRoomType(mappings, "SUPER-DELUXE")).toBeNull();
    expect(mapRoomType([], "DLX-BB")).toBeNull();
  });
});
