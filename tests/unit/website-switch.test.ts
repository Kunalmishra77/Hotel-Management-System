import { afterEach, describe, expect, it } from "vitest";
import { isPublicWebsiteEnabled, isWebsitePath } from "@/lib/constants/website";

describe("public website switch (CRM-only mode)", () => {
  afterEach(() => {
    delete process.env.PUBLIC_WEBSITE_ENABLED;
  });

  it("is off unless explicitly enabled", () => {
    expect(isPublicWebsiteEnabled()).toBe(false);
    process.env.PUBLIC_WEBSITE_ENABLED = "true";
    expect(isPublicWebsiteEnabled()).toBe(true);
  });

  it("treats the home page and website areas as website paths", () => {
    for (const p of ["/", "/portal", "/book/hauz-khas", "/book/x/manage", "/account", "/account/bookings", "/product", "/start", "/api/booking-engine/v1/x/availability"]) {
      expect(isWebsitePath(p), p).toBe(true);
    }
  });

  it("never blocks CRM pages or the token links the CRM sends out", () => {
    for (const p of ["/sign-in", "/forgot-password", "/reset-password", "/dashboard", "/bookings", "/bookings/abc/folio", "/order/t", "/review/t", "/track/t", "/api/health", "/api/webhooks/x"]) {
      expect(isWebsitePath(p), p).toBe(false);
    }
  });
});
