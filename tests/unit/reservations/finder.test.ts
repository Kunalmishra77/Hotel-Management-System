/**
 * Bookings finder — URL param parsing + date presets (pure). The Bookings pages
 * deep-link every view (KPI cards, status chips) through these params, so a bad
 * or missing value must fall back to a sane default, never throw.
 */
import { describe, expect, it } from "vitest";
import { addDays, finderPresets, parseFinderParams } from "@/features/reservations/domain/finder";

describe("parseFinderParams", () => {
  it("defaults: given property, any status, newest first, no dates", () => {
    expect(parseFinderParams({}, { prop: "p1" })).toEqual({ prop: "p1", status: null, dateField: "arrival", from: null, to: null, sort: "newest" });
  });

  it("keeps valid values and ignores junk", () => {
    const p = parseFinderParams({ prop: "all", status: "IN_HOUSE", bdate: "departure", bfrom: "2026-10-01", bto: "2026-10-31", sort: "guest" }, { prop: "p1" });
    expect(p).toEqual({ prop: "all", status: "IN_HOUSE", dateField: "departure", from: "2026-10-01", to: "2026-10-31", sort: "guest" });
    const junk = parseFinderParams({ status: "DROP TABLE", bdate: "x", bfrom: "29/10/2026", sort: "?" }, { prop: "p1" });
    expect(junk).toMatchObject({ status: null, dateField: "arrival", from: null, sort: "newest" });
  });

  it("accepts the ATTENTION pseudo-status", () => {
    expect(parseFinderParams({ status: "ATTENTION" }, { prop: "p1" }).status).toBe("ATTENTION");
  });

  it("with a date window, sorts by that date unless told otherwise", () => {
    expect(parseFinderParams({ bdate: "arrival", bfrom: "2026-10-29" }, { prop: "p1" }).sort).toBe("arrival");
    expect(parseFinderParams({ bdate: "departure", bto: "2026-10-29" }, { prop: "p1" }).sort).toBe("departure");
    expect(parseFinderParams({ bdate: "booked", bfrom: "2026-10-01" }, { prop: "p1" }).sort).toBe("newest");
  });

  it("swaps a reversed range", () => {
    expect(parseFinderParams({ bfrom: "2026-10-31", bto: "2026-10-01" }, { prop: "p1" })).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
  });
});

describe("finderPresets", () => {
  it("today / tomorrow / this week (Mon–Sun) / this month", () => {
    const p = Object.fromEntries(finderPresets("2026-10-29").map((x) => [x.key, [x.from, x.to]])); // a Thursday
    expect(p.today).toEqual(["2026-10-29", "2026-10-29"]);
    expect(p.tomorrow).toEqual(["2026-10-30", "2026-10-30"]);
    expect(p.week).toEqual(["2026-10-26", "2026-11-01"]);
    expect(p.month).toEqual(["2026-10-01", "2026-10-31"]);
  });

  it("week starts Monday even on a Sunday; month end handles short months", () => {
    const p = Object.fromEntries(finderPresets("2027-02-14").map((x) => [x.key, [x.from, x.to]])); // a Sunday
    expect(p.week).toEqual(["2027-02-08", "2027-02-14"]);
    expect(p.month).toEqual(["2027-02-01", "2027-02-28"]);
  });

  it("addDays crosses month/year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
