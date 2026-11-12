import { describe, expect, it } from "vitest";
import { parseGuestRecord, toIsoDate } from "@/features/guests/domain/record-parse";

describe("auto-fill a guest from record text — no AI (client, 12 Nov 2026)", () => {
  it("reads labelled lines", () => {
    const text = [
      "Name: RAVI KUMAR SHARMA",
      "Mobile: +91 98765-43210",
      "Email: ravi.k@example.com",
      "DOB: 12/03/1990",
      "Gender: M",
      "Address: 24 MG Road, Sector 5",
      "City: Gurugram",
      "State: Haryana",
      "PIN: 122001",
      "Company: Acme Pvt Ltd",
      "Purpose: Business",
    ].join("\n");
    expect(parseGuestRecord(text)).toEqual({
      fullName: "Ravi Kumar Sharma", mobile: "9876543210", email: "ravi.k@example.com", dob: "1990-03-12", gender: "Male",
      addressLine: "24 MG Road, Sector 5", city: "Gurugram", state: "Haryana", pincode: "122001", companyName: "Acme Pvt Ltd",
      purposeOfVisit: "Business", country: "India", nationality: "India",
    });
  });

  it("finds patterns in free text (a register line / an ID's text)", () => {
    const p = parseGuestRecord("Priya Nair\nGovernment of India\nDOB: 05-Jun-1988 Female\nflat 3, Andheri West Mumbai Maharashtra 400053\nph 9123456789");
    expect(p.fullName).toBe("Priya Nair");
    expect(p.dob).toBe("1988-06-05");
    expect(p.gender).toBe("Female");
    expect(p.state).toBe("Maharashtra");
    expect(p.pincode).toBe("400053");
    expect(p.mobile).toBe("9123456789");
  });

  it("never guesses: nothing recognisable → empty", () => {
    expect(parseGuestRecord("checked in late, paid cash")).toEqual({});
    expect(toIsoDate("31/12/1999")).toBe("1999-12-31");
    expect(toIsoDate("1999-12-31")).toBe("1999-12-31");
    expect(toIsoDate("not a date")).toBeNull();
  });
});
