/** 12 T-20/T-21 — MessagingProvider mock + selection + live gating. */
import { describe, expect, it } from "vitest";
import { mockProvider } from "@/lib/messaging/mock";
import { liveProvider, LIVE_BLOCKERS } from "@/lib/messaging/live";
import { resolveMessagingProvider } from "@/lib/messaging";

describe("MockProvider", () => {
  it("sends with no external call and a deterministic mock ref (FR-4)", async () => {
    const p = mockProvider("WHATSAPP");
    expect(p.isLive).toBe(false);
    const res = await p.sendTemplate({ channel: "WHATSAPP", toAddress: "+910000000000", body: "hi" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.providerRef.startsWith("mock-")).toBe(true);
    expect(await p.deliveryStatus("mock-x")).toBe("DELIVERED");
  });

  it("accepts an unsigned webhook in pure sandbox, verifies when a secret is set", () => {
    const p = mockProvider("WHATSAPP");
    expect(p.verifyWebhook({ rawBody: "{}", signature: "", secret: "" })).toBe(true);
    expect(p.verifyWebhook({ rawBody: "{}", signature: "bad", secret: "s3cret" })).toBe(false);
  });
});

describe("resolveMessagingProvider", () => {
  it("resolves the mock for a sandbox account or no account", () => {
    expect(resolveMessagingProvider(null).isLive).toBe(false);
    expect(resolveMessagingProvider({ channel: "SMS", provider: "msg91", mode: "sandbox" }).isLive).toBe(false);
  });

  it("resolves a live adapter only for an explicit live account", () => {
    const p = resolveMessagingProvider({ channel: "SMS", provider: "msg91", mode: "live" });
    expect(p.isLive).toBe(true);
  });
});

describe("live adapter honesty", () => {
  it("refuses to send and names the external blocker (T-21)", async () => {
    const p = liveProvider("SMS", "msg91", {});
    const res = await p.sendTemplate({ channel: "SMS", toAddress: "+910000000000", body: "hi" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain(LIVE_BLOCKERS.SMS);
  });
});
