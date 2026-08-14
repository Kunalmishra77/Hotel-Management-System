/**
 * Traceability: Phase 5 — clickable-KPI board filter.
 *
 * The `?view=` param comes from a URL, so a bad value must fall back to "all",
 * never throw or leak an odd state into the board.
 */
import { describe, expect, it } from "vitest";
import { parseBoardView, BOARD_VIEW_LABEL } from "@/features/reservations/domain/board-view";

describe("parseBoardView", () => {
  it("accepts the known segments", () => {
    expect(parseBoardView("arrivals")).toBe("arrivals");
    expect(parseBoardView("in-house")).toBe("in-house");
    expect(parseBoardView("departures")).toBe("departures");
    expect(parseBoardView("all")).toBe("all");
  });

  it("falls back to 'all' for anything unknown", () => {
    for (const bad of [undefined, null, "", "ARRIVALS", "foo", 5, "in_house"]) {
      expect(parseBoardView(bad)).toBe("all");
    }
  });

  it("labels the three filterable segments", () => {
    expect(BOARD_VIEW_LABEL.arrivals).toBeTruthy();
    expect(BOARD_VIEW_LABEL["in-house"]).toBeTruthy();
    expect(BOARD_VIEW_LABEL.departures).toBeTruthy();
  });
});
