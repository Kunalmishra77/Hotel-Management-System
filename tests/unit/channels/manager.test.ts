/** 13 T-6 — ChannelManager mock contract + provider selection + live honesty. */
import { describe, expect, it } from "vitest";
import { mockChannelManager } from "@/lib/channels/mock";
import { liveChannelManager } from "@/lib/channels/live";
import { resolveChannelManager, liveBlockerFor } from "@/lib/channels";

const range = { from: new Date("2027-06-01"), to: new Date("2027-06-03") };

describe("MockChannelManager (FR-2/3)", () => {
  it("pushes with no external call and a deterministic ref", async () => {
    const m = mockChannelManager("booking_com");
    expect(m.isLive).toBe(false);
    const a = await m.pushAvailability({ propertyId: "p", categoryId: "c", externalRoomType: "DLX", ...range, available: 3 });
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.ref.startsWith("mock-avail-")).toBe(true);
    const r = await m.pushRates({ propertyId: "p", categoryId: "c", externalRoomType: "DLX", ...range, ratePaise: 100 });
    expect(r.ok).toBe(true);
  });

  it("pulls the configured deterministic fixtures", async () => {
    const fixtures = [{ provider: "booking_com", externalId: "X1", type: "reservation.new", payload: {} }];
    const m = mockChannelManager("booking_com", fixtures);
    expect(await m.pullReservations()).toEqual(fixtures);
  });

  it("accepts an unsigned webhook in pure sandbox, verifies when a secret is set", () => {
    const m = mockChannelManager("booking_com");
    expect(m.verifyWebhook({ rawBody: "{}", signature: "", secret: "" })).toBe(true);
    expect(m.verifyWebhook({ rawBody: "{}", signature: "bad", secret: "s3cret" })).toBe(false);
  });
});

describe("resolveChannelManager selection (FR-17/18)", () => {
  it("resolves the mock for a sandbox/uncertified/inactive account", () => {
    expect(resolveChannelManager({ provider: "booking_com", isActive: false, certifiedAt: null, credentialsRef: null }).isLive).toBe(false);
    // active but not certified → still sandbox
    expect(resolveChannelManager({ provider: "booking_com", isActive: true, certifiedAt: null, credentialsRef: null }).isLive).toBe(false);
    // certified but no credentials → still sandbox
    expect(resolveChannelManager({ provider: "booking_com", isActive: true, certifiedAt: new Date(), credentialsRef: null }).isLive).toBe(false);
  });

  it("resolves the live adapter only when active AND certified AND credentialed", () => {
    const m = resolveChannelManager({ provider: "booking_com", isActive: true, certifiedAt: new Date(), credentialsRef: "vault://x" });
    expect(m.isLive).toBe(true);
  });
});

describe("live adapter honesty (integrations.md)", () => {
  it("refuses to push and names the certification blocker", async () => {
    const m = liveChannelManager("booking_com", {});
    const res = await m.pushAvailability({ propertyId: "p", categoryId: "c", externalRoomType: "DLX", ...range, available: 1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain(liveBlockerFor("booking_com"));
  });
});
