/**
 * 12 · Communications — T-2 seed fixtures (specs/12-communications/user-stories.md).
 *
 * TPL-CONF (BOOKING_CONFIRMATION / WhatsApp / en, approved providerTemplateId),
 * TPL-MKTG (FESTIVAL_OFFER / WhatsApp / en, marketing), plus PAYMENT_REMINDER and
 * a scheduled PRE_ARRIVAL template. Event + scheduled + marketing automations, a
 * sandbox WhatsApp MessagingAccount (no live creds), and consent rows: G-RAVI
 * granted, G-MEHTA opted-out (the G-NOAD role).
 *
 * Idempotent (fixed ids / upserts), like every seed module.
 */
import type { PrismaClient } from "@prisma/client";
import { GUEST_MEHTA_ID, GUEST_RAVI_ID, ORG_ID } from "./fixtures";

export async function seedCommunications(prisma: PrismaClient): Promise<void> {
  // ---- Templates -----------------------------------------------------------
  const templates = [
    { key: "BOOKING_CONFIRMATION", channel: "WHATSAPP" as const, language: "en", body: "Hi {{guestName}}, your booking at {{propertyName}} is confirmed for {{checkInDate}}.", providerTemplateId: "hsm_booking_confirmation_en" },
    { key: "FESTIVAL_OFFER", channel: "WHATSAPP" as const, language: "en", body: "Hi {{guestName}}! Festive offer at {{propertyName}}: use code {{couponCode}}.", providerTemplateId: null },
    // No PAYMENT_REMINDER template — MoM 3 Aug 2026 (binding): no payment reminders to guests.
    { key: "PRE_ARRIVAL", channel: "WHATSAPP" as const, language: "en", body: "Hi {{guestName}}, we look forward to your arrival on {{checkInDate}}. Wi-Fi: {{wifiSsid}}.", providerTemplateId: "hsm_pre_arrival_en" },
    { key: "WELCOME_CHECKIN", channel: "WHATSAPP" as const, language: "en", body: "Welcome to {{propertyName}}, {{guestName}}! You are checked in. Wi-Fi: {{wifiSsid}}. Enjoy your stay.", providerTemplateId: "hsm_welcome_checkin_en" },
    { key: "CHECKOUT_THANKYOU", channel: "WHATSAPP" as const, language: "en", body: "Thank you for staying at {{propertyName}}, {{guestName}}! How was your stay?", providerTemplateId: "hsm_checkout_thankyou_en" },
    // Email variants (client req #9/#16) — check-in + booking confirmations on
    // email as well as WhatsApp. Live delivery needs domain verification (SPF/DKIM);
    // until then these render to the sandbox outbox like every other channel.
    { key: "BOOKING_CONFIRMATION", channel: "EMAIL" as const, language: "en", body: "Dear {{guestName}},\n\nYour booking at {{propertyName}} is confirmed for {{checkInDate}}.\n\nWe look forward to welcoming you.\n\nWarm regards,\n{{propertyName}}", providerTemplateId: null },
    { key: "WELCOME_CHECKIN", channel: "EMAIL" as const, language: "en", body: "Dear {{guestName}},\n\nWelcome to {{propertyName}} — you are now checked in. Wi-Fi: {{wifiSsid}}.\n\nDo let our front desk know if there is anything we can arrange. Enjoy your stay!\n\nWarm regards,\n{{propertyName}}", providerTemplateId: null },
    { key: "CHECKOUT_THANKYOU", channel: "EMAIL" as const, language: "en", body: "Dear {{guestName}},\n\nThank you for staying at {{propertyName}}. We hope you had a comfortable stay and would love to welcome you again.\n\nWarm regards,\n{{propertyName}}", providerTemplateId: null },
    // Share-a-bill (client req #16 — "share bills on email + WhatsApp"). Reception
    // triggers these manually from the invoice; live delivery needs BSP/domain setup.
    { key: "INVOICE_SHARE", channel: "WHATSAPP" as const, language: "en", body: "Hi {{guestName}}, here is your invoice {{invoiceNumber}} from {{propertyName}} for {{invoiceTotal}}. Thank you for staying with us.", providerTemplateId: "hsm_invoice_share_en" },
    { key: "INVOICE_SHARE", channel: "EMAIL" as const, language: "en", body: "Dear {{guestName}},\n\nPlease find the details of your invoice {{invoiceNumber}} from {{propertyName}}, total {{invoiceTotal}}.\n\nDo reply to this email if you need a copy of the PDF or have any question about the bill.\n\nWarm regards,\n{{propertyName}}", providerTemplateId: null },
  ];
  for (const t of templates) {
    await prisma.messageTemplate.upsert({
      where: { orgId_key_channel_language: { orgId: ORG_ID, key: t.key, channel: t.channel, language: t.language } },
      create: { orgId: ORG_ID, ...t, isActive: true },
      update: { body: t.body, providerTemplateId: t.providerTemplateId, isActive: true },
    });
  }

  // ---- Automations ---------------------------------------------------------
  const automations = [
    { id: "auto_booking_confirmation", category: "BEFORE_ARRIVAL" as const, triggerEvent: "ReservationCreated", scheduleOffsetMinutes: null, templateKey: "BOOKING_CONFIRMATION", channel: "WHATSAPP" as const },
    { id: "auto_pre_arrival", category: "BEFORE_ARRIVAL" as const, triggerEvent: null, scheduleOffsetMinutes: -1440, templateKey: "PRE_ARRIVAL", channel: "WHATSAPP" as const },
    { id: "auto_welcome_checkin", category: "DURING_STAY" as const, triggerEvent: "GuestCheckedIn", scheduleOffsetMinutes: null, templateKey: "WELCOME_CHECKIN", channel: "WHATSAPP" as const },
    { id: "auto_checkout_thankyou", category: "AFTER_CHECKOUT" as const, triggerEvent: "GuestCheckedOut", scheduleOffsetMinutes: null, templateKey: "CHECKOUT_THANKYOU", channel: "WHATSAPP" as const },
    { id: "auto_festival_offer", category: "MARKETING" as const, triggerEvent: null, scheduleOffsetMinutes: null, templateKey: "FESTIVAL_OFFER", channel: "WHATSAPP" as const, isActive: false },
    // Email automations (client req #9/#16) — fire alongside the WhatsApp ones so a
    // guest gets both a WhatsApp and an email confirmation on booking + check-in.
    { id: "auto_booking_confirmation_email", category: "BEFORE_ARRIVAL" as const, triggerEvent: "ReservationCreated", scheduleOffsetMinutes: null, templateKey: "BOOKING_CONFIRMATION", channel: "EMAIL" as const },
    { id: "auto_welcome_checkin_email", category: "DURING_STAY" as const, triggerEvent: "GuestCheckedIn", scheduleOffsetMinutes: null, templateKey: "WELCOME_CHECKIN", channel: "EMAIL" as const },
    { id: "auto_checkout_thankyou_email", category: "AFTER_CHECKOUT" as const, triggerEvent: "GuestCheckedOut", scheduleOffsetMinutes: null, templateKey: "CHECKOUT_THANKYOU", channel: "EMAIL" as const },
  ];
  for (const a of automations) {
    const { id, ...rest } = a;
    await prisma.messageAutomation.upsert({
      where: { id },
      create: { id, orgId: ORG_ID, isActive: true, ...rest },
      update: { ...rest },
    });
  }

  // ---- Sandbox messaging account (no live creds — FR-23/FR-4) --------------
  await prisma.messagingAccount.upsert({
    where: { orgId_channel_provider: { orgId: ORG_ID, channel: "WHATSAPP", provider: "mock" } },
    create: { orgId: ORG_ID, channel: "WHATSAPP", provider: "mock", mode: "sandbox", config: {} },
    update: { mode: "sandbox" },
  });
  // Email account uses the "smtp" adapter: it stays sandbox (mock) until the
  // operator flips mode→"live" AND sets SMTP_* env (e.g. a Gmail app password) —
  // then it sends for real over SMTP with no code change. See ADR 0001-smtp-email.
  await prisma.messagingAccount.upsert({
    where: { orgId_channel_provider: { orgId: ORG_ID, channel: "EMAIL", provider: "smtp" } },
    create: { orgId: ORG_ID, channel: "EMAIL", provider: "smtp", mode: "sandbox", config: {} },
    update: { mode: "sandbox" },
  });

  // ---- Consent (G-RAVI granted; G-MEHTA opted-out = G-NOAD) -----------------
  await prisma.communicationConsent.upsert({
    where: { guestId_channel: { guestId: GUEST_RAVI_ID, channel: "WHATSAPP" } },
    create: { guestId: GUEST_RAVI_ID, channel: "WHATSAPP", marketingStatus: "GRANTED" },
    update: { marketingStatus: "GRANTED" },
  });
  await prisma.communicationConsent.upsert({
    where: { guestId_channel: { guestId: GUEST_MEHTA_ID, channel: "WHATSAPP" } },
    create: { guestId: GUEST_MEHTA_ID, channel: "WHATSAPP", marketingStatus: "OPTED_OUT" },
    update: { marketingStatus: "OPTED_OUT" },
  });
}
