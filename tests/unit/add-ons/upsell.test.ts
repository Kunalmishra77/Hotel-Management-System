/**
 * Traceability: Wave 3 — add-on / upsell eligibility + lifecycle (pure).
 *
 * A guest may request an extra on an upcoming/in-house booking, but the folio
 * charge posts only for an active (IN_HOUSE) stay. The lifecycle is forward-only:
 * a placed request is accepted or declined, never reopened.
 */
import { describe, expect, it } from "vitest";
import { canRequestAddOn, canPostAddOnCharge, canDecide, ADDON_REQUEST_NEXT } from "@/features/add-ons/domain/upsell";

describe("canRequestAddOn", () => {
  it("allows confirmed + in-house, refuses everything else", () => {
    expect(canRequestAddOn("CONFIRMED")).toBe(true);
    expect(canRequestAddOn("IN_HOUSE")).toBe(true);
    for (const s of ["ENQUIRY", "CHECKED_OUT", "CANCELLED", "NO_SHOW", ""]) expect(canRequestAddOn(s)).toBe(false);
  });
});

describe("canPostAddOnCharge", () => {
  it("allows only IN_HOUSE (a folio exists only for an active stay)", () => {
    expect(canPostAddOnCharge("IN_HOUSE")).toBe(true);
    for (const s of ["CONFIRMED", "ENQUIRY", "CHECKED_OUT", "CANCELLED", "NO_SHOW"]) expect(canPostAddOnCharge(s)).toBe(false);
  });
});

describe("ADDON_REQUEST_NEXT / canDecide (forward-only)", () => {
  it("a REQUESTED request can be accepted or declined, terminal states can't move", () => {
    expect([...ADDON_REQUEST_NEXT.REQUESTED!]).toEqual(["ACCEPTED", "DECLINED"]);
    expect(ADDON_REQUEST_NEXT.ACCEPTED).toEqual([]);
    expect(ADDON_REQUEST_NEXT.DECLINED).toEqual([]);
    expect(canDecide("REQUESTED", "ACCEPTED")).toBe(true);
    expect(canDecide("REQUESTED", "DECLINED")).toBe(true);
    expect(canDecide("ACCEPTED", "ACCEPTED")).toBe(false);
    expect(canDecide("ACCEPTED", "DECLINED")).toBe(false);
    expect(canDecide("DECLINED", "ACCEPTED")).toBe(false);
  });
});
