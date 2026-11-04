/** Message log labels — a sandbox "send" must never read as delivered. */
import { describe, expect, it } from "vitest";
import { messageTitle, statusLabel } from "@/features/communications/components/message-labels";
import { isSandboxRef } from "@/features/communications/queries";
import { emailSubject } from "@/lib/messaging/subjects";

describe("message labels", () => {
  it("labels a sandbox delivery as not sent, a real one as delivered", () => {
    expect(statusLabel("DELIVERED", true)).toBe("Not sent (test mode)");
    expect(statusLabel("DELIVERED", false)).toBe("Delivered");
    expect(statusLabel("FAILED", true)).toBe("Failed");
    expect(statusLabel("QUEUED", false)).toBe("Waiting to send");
  });
  it("detects sandbox provider refs", () => {
    expect(isSandboxRef("mock-email-123")).toBe(true);
    expect(isSandboxRef("<abc@smtp.gmail.com>")).toBe(false);
    expect(isSandboxRef(null)).toBe(false);
  });
  it("names messages and email subjects in plain words", () => {
    expect(messageTitle("FOLLOWUP_10D", "AFTER_CHECKOUT")).toBe("Follow-up (10 days after stay)");
    expect(messageTitle("SOME_NEW_KEY", null)).toBe("Some New Key");
    expect(emailSubject("INVOICE_SHARE")).toBe("Your invoice");
    expect(emailSubject(null)).toBe("Woodpecker Apartments & Suites");
  });
});
