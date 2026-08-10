/**
 * 12 Communications — integration (FR-3..22, AC-1..18). Everything runs on the
 * deterministic mock provider (no external accounts). Auth is mocked at the
 * boundary and switched per test via `vi.hoisted`. Dedicated rows (C12_* / test
 * guests) are seeded so other suites can't perturb these assertions.
 */
import { vi } from "vitest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import type { SessionClaims } from "@/lib/auth/claims";

const h = vi.hoisted(() => ({ user: null as SessionClaims | null }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => {
    if (!h.user) throw new Error("no acting user set");
    return h.user;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { ORG_ID, PROP_A_ID, USER_MANAGER_ID, USER_RECEPTION_A_ID } from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { encryptString } from "@/lib/crypto/encryption";
import { communicationsConsumer } from "@/features/communications/events/consumer";
import { dispatchQueuedMessages, MAX_SEND_ATTEMPTS } from "@/features/communications/dispatch";
import { handleMessagingWebhook } from "@/features/communications/webhook";
import { launchCampaign, manageTemplate, sendManual, captureFeedback, recordSentiment } from "@/features/communications/actions";
import type { EventEnvelope } from "@/lib/events/dispatch";

const prisma = createPrismaClient();

const GUEST = "c12_guest_ok"; // granted
const GUEST_OPT = "c12_guest_opt"; // opted-out (G-NOAD role)
const KEYS = { conf: "C12_CONFIRMATION", broken: "C12_BROKEN", offer: "C12_OFFER", sms: "C12_SMS_NOAPPROVE", email: "C12_EMAIL_FAIL" };
const AUTOS = ["c12_conf", "c12_broken", "c12_inactive"];

async function claims(userId: string): Promise<SessionClaims> {
  const c = await assembleClaims(prisma, userId);
  if (!c) throw new Error("no claims");
  return c;
}

function envelope(type: string, aggregateId: string, payload: Record<string, unknown>): EventEnvelope {
  return { id: `c12_evt_${Math.random().toString(36).slice(2)}`, seq: 1n, type, orgId: ORG_ID, propertyId: PROP_A_ID, aggregateId, payload, occurredAt: new Date() };
}

beforeAll(async () => {
  for (const [id, granted] of [[GUEST, true], [GUEST_OPT, false]] as const) {
    await prisma.guest.upsert({
      where: { id },
      create: { id, orgId: ORG_ID, fullName: granted ? "Comms Granted" : "Comms OptedOut", mobile: encryptString("9800000012"), whatsapp: encryptString("9800000012"), email: encryptString("c12@ex.com") },
      update: { deletedAt: null },
    });
  }

  const templates = [
    { key: KEYS.conf, body: "Hi {{guestName}}, booked at {{propertyName}}.", providerTemplateId: "hsm_c12_conf" },
    { key: KEYS.broken, body: "Room {{roomNumber}} is ready.", providerTemplateId: null },
    { key: KEYS.offer, body: "Hi {{guestName}}, use code {{couponCode}}.", providerTemplateId: null },
    { key: "PAYMENT_REMINDER", body: "Hi {{guestName}}, a balance is pending.", providerTemplateId: "hsm_pay" },
  ];
  for (const t of templates) {
    await prisma.messageTemplate.upsert({
      where: { orgId_key_channel_language: { orgId: ORG_ID, key: t.key, channel: "WHATSAPP", language: "en" } },
      create: { orgId: ORG_ID, key: t.key, channel: "WHATSAPP", language: "en", body: t.body, providerTemplateId: t.providerTemplateId, isActive: true },
      update: { body: t.body, providerTemplateId: t.providerTemplateId, isActive: true },
    });
  }

  const autos = [
    { id: "c12_conf", category: "BEFORE_ARRIVAL" as const, triggerEvent: "ReservationCreated", templateKey: KEYS.conf, isActive: true },
    { id: "c12_broken", category: "DURING_STAY" as const, triggerEvent: "GuestCheckedIn", templateKey: KEYS.broken, isActive: true },
    { id: "c12_inactive", category: "AFTER_CHECKOUT" as const, triggerEvent: "ReservationModified", templateKey: KEYS.conf, isActive: false },
  ];
  for (const a of autos) {
    await prisma.messageAutomation.upsert({
      where: { id: a.id },
      create: { id: a.id, orgId: ORG_ID, category: a.category, triggerEvent: a.triggerEvent, templateKey: a.templateKey, channel: "WHATSAPP", isActive: a.isActive },
      update: { isActive: a.isActive },
    });
  }

  await prisma.messagingAccount.upsert({
    where: { orgId_channel_provider: { orgId: ORG_ID, channel: "WHATSAPP", provider: "mock" } },
    create: { orgId: ORG_ID, channel: "WHATSAPP", provider: "mock", mode: "sandbox", config: {} },
    update: { mode: "sandbox", config: {} },
  });

  await prisma.communicationConsent.upsert({
    where: { guestId_channel: { guestId: GUEST, channel: "WHATSAPP" } },
    create: { guestId: GUEST, channel: "WHATSAPP", marketingStatus: "GRANTED" },
    update: { marketingStatus: "GRANTED" },
  });
  await prisma.communicationConsent.upsert({
    where: { guestId_channel: { guestId: GUEST_OPT, channel: "WHATSAPP" } },
    create: { guestId: GUEST_OPT, channel: "WHATSAPP", marketingStatus: "OPTED_OUT" },
    update: { marketingStatus: "OPTED_OUT" },
  });
});

afterAll(async () => {
  await prisma.messageLog.deleteMany({ where: { OR: [{ guestId: { in: [GUEST, GUEST_OPT] } }, { templateKey: { in: [KEYS.sms, KEYS.email] } }] } });
  await prisma.feedback.deleteMany({ where: { guestId: { in: [GUEST, GUEST_OPT] } } });
  await prisma.campaign.deleteMany({ where: { templateKey: KEYS.offer } });
  await prisma.communicationConsent.deleteMany({ where: { guestId: { in: [GUEST, GUEST_OPT] } } });
  await prisma.messageTemplate.deleteMany({ where: { orgId: ORG_ID, key: { in: [KEYS.conf, KEYS.broken, KEYS.offer] } } });
  await prisma.messageAutomation.deleteMany({ where: { id: { in: AUTOS } } });
  await prisma.messagingAccount.deleteMany({ where: { orgId: ORG_ID, provider: { in: ["twilio", "resend", "secure_mock"] } } });
  await prisma.integrationInbox.deleteMany({ where: { provider: { in: ["messaging:mock", "messaging:optout", "messaging:secure_mock", "comms:payment-reminder"] } } });
  await prisma.guestSegment.deleteMany({ where: { orgId: ORG_ID, name: "c12-test-seg" } });
  await prisma.guest.deleteMany({ where: { id: { in: [GUEST, GUEST_OPT] } } });
  await prisma.$disconnect();
});

describe("US-1 event-driven transactional message (AC-1/2/18)", () => {
  let logId: string;

  it("consumer renders + enqueues a QUEUED MessageLog, not an inline send (AC-1)", async () => {
    await communicationsConsumer.handle(envelope("ReservationCreated", "c12_res_1", { guestId: GUEST, propertyId: PROP_A_ID, checkInDate: "2026-08-20" }));
    const log = await prisma.messageLog.findFirst({ where: { guestId: GUEST, templateKey: KEYS.conf }, orderBy: { createdAt: "desc" } });
    expect(log).not.toBeNull();
    expect(log!.status).toBe("QUEUED");
    expect(log!.channel).toBe("WHATSAPP");
    logId = log!.id;
  });

  it("carries the rendered body on the MessageQueued event, not PII on the log (AC-18)", async () => {
    const log = await prisma.messageLog.findUnique({ where: { id: logId }, select: { triggeredByEvent: true, toAddress: true } });
    const event = await prisma.domainEvent.findUnique({ where: { id: log!.triggeredByEvent! }, select: { type: true, payload: true } });
    expect(event!.type).toBe("MessageQueued");
    const payload = event!.payload as Record<string, unknown>;
    expect(String(payload.body)).toContain("Comms Granted"); // rendered guest name (within purpose)
    expect(payload).not.toHaveProperty("toAddress"); // no address in the event payload (FR-15)
  });

  it("sandbox worker delivers with no external call: QUEUED→DELIVERED (AC-2)", async () => {
    await dispatchQueuedMessages(prisma);
    const log = await prisma.messageLog.findUnique({ where: { id: logId } });
    expect(log!.status).toBe("DELIVERED");
    expect(log!.providerRef?.startsWith("mock-")).toBe(true);
  });
});

describe("US safety — render failure dead-letters (AC-16)", () => {
  it("a missing {{roomNumber}} dead-letters with RENDER_MISSING_VAR, never a partial send", async () => {
    await communicationsConsumer.handle(envelope("GuestCheckedIn", "c12_res_2", { guestId: GUEST, propertyId: PROP_A_ID }));
    const log = await prisma.messageLog.findFirst({ where: { guestId: GUEST, templateKey: KEYS.broken }, orderBy: { createdAt: "desc" } });
    expect(log!.status).toBe("FAILED");
    expect(log!.deadLetteredAt).not.toBeNull();
    expect(log!.error).toBe("RENDER_MISSING_VAR");
  });
});

describe("US-3 consent, marketing, purpose-limitation (AC-8)", () => {
  it("marketing campaign skips the opted-out guest, delivers to the granted one (AC-8/12)", async () => {
    h.user = await claims(USER_MANAGER_ID);
    const res = await launchCampaign({ templateKey: KEYS.offer, channel: "WHATSAPP", recipientGuestIds: [GUEST, GUEST_OPT], propertyId: PROP_A_ID });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.enqueued).toBe(1);
      expect(res.data.skipped).toBe(1);
    }
    expect(await prisma.messageLog.count({ where: { guestId: GUEST, templateKey: KEYS.offer } })).toBe(1);
    expect(await prisma.messageLog.count({ where: { guestId: GUEST_OPT, templateKey: KEYS.offer } })).toBe(0);
  });

  it("targets an AI segment — resolves membership server-side, still honours consent (MoM bulk marketing)", async () => {
    const seg = await prisma.guestSegment.create({
      data: { orgId: ORG_ID, name: "c12-test-seg", ruleJson: { kind: "test" }, guestIds: [GUEST, GUEST_OPT] },
      select: { id: true },
    });
    h.user = await claims(USER_MANAGER_ID);
    const res = await launchCampaign({ templateKey: KEYS.offer, channel: "WHATSAPP", segmentId: seg.id, propertyId: PROP_A_ID });
    expect(res.ok).toBe(true);
    if (res.ok) {
      // Segment membership resolved to 2; consent still skips the opted-out guest.
      expect(res.data.enqueued).toBe(1);
      expect(res.data.skipped).toBe(1);
    }
    // The campaign records which segment it targeted.
    const campaign = await prisma.campaign.findFirst({ where: { segmentRef: seg.id }, select: { id: true } });
    expect(campaign).not.toBeNull();
  });

  it("a transactional message to the opted-out guest IS allowed (purpose-limitation, AC-8)", async () => {
    h.user = await claims(USER_MANAGER_ID);
    const res = await sendManual({ guestId: GUEST_OPT, propertyId: PROP_A_ID, templateKey: KEYS.conf, channel: "WHATSAPP" });
    expect(res.ok).toBe(true);
    expect(await prisma.messageLog.count({ where: { guestId: GUEST_OPT, templateKey: KEYS.conf } })).toBe(1);
  });
});

describe("US-5 feedback + sentiment contract (AC-14)", () => {
  it("captures Feedback + emits FeedbackReceived; 18 writes the label via recordSentiment", async () => {
    h.user = await claims(USER_MANAGER_ID);
    const cap = await captureFeedback({ guestId: GUEST, propertyId: PROP_A_ID, rating: 2, comment: "AC was noisy" });
    expect(cap.ok).toBe(true);
    const feedbackId = cap.ok ? cap.data.feedbackId : "";
    const event = await prisma.domainEvent.findFirst({ where: { type: "FeedbackReceived", aggregateId: feedbackId } });
    expect(event).not.toBeNull();

    const sent = await recordSentiment({ feedbackId, label: "NEGATIVE", score: -0.8 });
    expect(sent.ok).toBe(true);
    const fb = await prisma.feedback.findUnique({ where: { id: feedbackId } });
    expect(fb!.sentiment).toBe("NEGATIVE");
    expect(fb!.sentimentScore).toBeCloseTo(-0.8);
  });
});

describe("US-2 delivery status + dedupe (AC-5/6)", () => {
  const providerRef = "c12_ref_status";
  it("advances status on a signed webhook; ignores a duplicate (AC-5/6)", async () => {
    await prisma.messageLog.create({ data: { propertyId: PROP_A_ID, guestId: GUEST, channel: "WHATSAPP", templateKey: KEYS.conf, toAddress: "9800000012", status: "SENT", providerRef } });
    const body = JSON.stringify({ kind: "status", providerRef, status: "DELIVERED" });

    const first = await handleMessagingWebhook({ provider: "mock", rawBody: body, signature: "" });
    expect(first.status).toBe("applied");
    expect((await prisma.messageLog.findFirst({ where: { providerRef } }))!.status).toBe("DELIVERED");

    const dup = await handleMessagingWebhook({ provider: "mock", rawBody: body, signature: "" });
    expect(dup.status).toBe("duplicate");
  });

  it("opt-out (STOP) sets marketing consent OPTED_OUT for the channel (AC-9)", async () => {
    const body = JSON.stringify({ kind: "optout", guestId: GUEST });
    const out = await handleMessagingWebhook({ provider: "mock", rawBody: body, signature: "" });
    expect(out.status).toBe("applied");
    const consent = await prisma.communicationConsent.findUnique({ where: { guestId_channel: { guestId: GUEST, channel: "WHATSAPP" } } });
    expect(consent!.marketingStatus).toBe("OPTED_OUT");
  });

  it("rejects a webhook whose signature fails verification", async () => {
    await prisma.messagingAccount.upsert({
      where: { orgId_channel_provider: { orgId: ORG_ID, channel: "SMS", provider: "secure_mock" } },
      create: { orgId: ORG_ID, channel: "SMS", provider: "secure_mock", mode: "sandbox", config: { webhookSecret: "s3cr3t" } },
      update: { config: { webhookSecret: "s3cr3t" } },
    });
    await expect(handleMessagingWebhook({ provider: "secure_mock", rawBody: "{}", signature: "sha256=deadbeef" })).rejects.toMatchObject({ code: "WEBHOOK_SIGNATURE_INVALID" });
  });
});

describe("US-1 live-send gating + dead-letter (AC-4/7)", () => {
  async function seedManualQueued(channel: "SMS" | "EMAIL", provider: string, key: string): Promise<string> {
    // Ensure the live account is the ONLY account for this channel so dispatch's
    // findFirst resolves it deterministically (drops the secure_mock SMS row etc.).
    await prisma.messagingAccount.deleteMany({ where: { orgId: ORG_ID, channel, provider: { not: provider } } });
    await prisma.messagingAccount.upsert({
      where: { orgId_channel_provider: { orgId: ORG_ID, channel, provider } },
      create: { orgId: ORG_ID, channel, provider, mode: "live", config: {} },
      update: { mode: "live" },
    });
    const event = await prisma.domainEvent.create({ data: { orgId: ORG_ID, type: "MessageQueued", aggregateId: "manual", payload: { body: "hello" } }, select: { id: true } });
    const log = await prisma.messageLog.create({ data: { propertyId: PROP_A_ID, channel, templateKey: key, toAddress: "x@ex.com", status: "QUEUED", triggeredByEvent: event.id }, select: { id: true } });
    return log.id;
  }

  it("blocks a live WhatsApp/SMS send with no approved providerTemplateId (AC-4)", async () => {
    const id = await seedManualQueued("SMS", "twilio", KEYS.sms);
    await dispatchQueuedMessages(prisma);
    const log = await prisma.messageLog.findUnique({ where: { id } });
    expect(log!.status).toBe("FAILED");
    expect(log!.error).toBe("TEMPLATE_NOT_APPROVED");
    expect(log!.deadLetteredAt).not.toBeNull();
  });

  it("retries a failing live send then dead-letters + alerts (AC-7)", async () => {
    const id = await seedManualQueued("EMAIL", "resend", KEYS.email);
    for (let i = 0; i < MAX_SEND_ATTEMPTS; i++) await dispatchQueuedMessages(prisma);
    const log = await prisma.messageLog.findUnique({ where: { id } });
    expect(log!.status).toBe("FAILED");
    expect(log!.attempts).toBeGreaterThanOrEqual(MAX_SEND_ATTEMPTS);
    expect(log!.deadLetteredAt).not.toBeNull();
  });
});

describe("US-4 RBAC + inactive automation (AC-13/17)", () => {
  it("denies template management to a user without communication:template-manage (AC-17)", async () => {
    h.user = await claims(USER_RECEPTION_A_ID);
    const res = await manageTemplate({ key: "C12_REC", channel: "WHATSAPP", language: "en", body: "hi {{guestName}}" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
  });

  it("generates nothing from an inactive automation (AC-13)", async () => {
    const before = await prisma.messageLog.count({ where: { guestId: GUEST } });
    await communicationsConsumer.handle(envelope("ReservationModified", "c12_res_3", { guestId: GUEST, propertyId: PROP_A_ID }));
    const after = await prisma.messageLog.count({ where: { guestId: GUEST } });
    expect(after).toBe(before);
  });
});

describe("US-5 payment reminder idempotency across 06 + 14 (AC-15/FR-20)", () => {
  it("enqueues at most one reminder per (folio, businessDate)", async () => {
    const evt = () => envelope("PaymentDueDetected", "c12_folio_1", { guestId: GUEST, propertyId: PROP_A_ID, businessDate: "2026-08-01" });
    await communicationsConsumer.handle(evt()); // 06 checkout
    await communicationsConsumer.handle(evt()); // 14 night-audit close (same folio/day)
    const count = await prisma.messageLog.count({ where: { guestId: GUEST, templateKey: "PAYMENT_REMINDER" } });
    expect(count).toBe(1);
  });
});
