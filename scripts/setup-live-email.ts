/**
 * Go-live for guest EMAIL (4 Nov 2026). The live org only had the 10-day
 * follow-up; this adds the transactional email templates + automations (booking
 * confirmed, welcome at check-in, thank-you at check-out, and the invoice-share
 * template used by "Share bill") and switches the EMAIL channel to the SMTP
 * adapter in LIVE mode — after which mail really goes out using the SMTP_* env
 * (Gmail app password) set on the server + worker.
 *
 * Templates use only fields that are always present (guest, hotel, booking code,
 * dates, nights) so a message can never fail to render. Existing templates /
 * automations are left as they are (create-only). Audited.
 *   npx tsx scripts/setup-live-email.ts                      (dry-run)
 *   $env:CONFIRM="YES"; npx tsx scripts/setup-live-email.ts  (apply)
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runWithSystemContext } from "../src/lib/context";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });

const TEMPLATES: { key: string; body: string }[] = [
  { key: "BOOKING_CONFIRMATION", body: "Dear {{guestName}},\n\nThank you for choosing {{propertyName}}. Your booking {{bookingCode}} is confirmed.\n\nCheck-in: {{checkInDate}}\nCheck-out: {{checkOutDate}}\nNights: {{nights}}\n\nWe look forward to welcoming you. Just reply to this email if you need anything before your arrival.\n\nWarm regards,\n{{propertyName}}" },
  { key: "WELCOME_CHECKIN", body: "Dear {{guestName}},\n\nWelcome to {{propertyName}} — you are now checked in (booking {{bookingCode}}, until {{checkOutDate}}).\n\nPlease let our front desk know if there is anything we can arrange for you. Enjoy your stay!\n\nWarm regards,\n{{propertyName}}" },
  { key: "CHECKOUT_THANKYOU", body: "Dear {{guestName}},\n\nThank you for staying at {{propertyName}}. We hope you had a comfortable stay and would love to welcome you again.\n\nWarm regards,\n{{propertyName}}" },
  { key: "INVOICE_SHARE", body: "Dear {{guestName}},\n\nPlease find the details of your invoice {{invoiceNumber}} from {{propertyName}}, total {{invoiceTotal}}.\n\nDo reply to this email if you need a copy of the PDF or have any question about the bill.\n\nWarm regards,\n{{propertyName}}" },
];
const AUTOMATIONS = [
  { category: "BEFORE_ARRIVAL" as const, triggerEvent: "ReservationCreated", templateKey: "BOOKING_CONFIRMATION" },
  { category: "DURING_STAY" as const, triggerEvent: "GuestCheckedIn", templateKey: "WELCOME_CHECKIN" },
  { category: "AFTER_CHECKOUT" as const, triggerEvent: "GuestCheckedOut", templateKey: "CHECKOUT_THANKYOU" },
];

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  if (orgs.length !== 1) throw new Error(`expected one organization, found ${orgs.length}`);
  const org = orgs[0]!;
  const existingT = await prisma.messageTemplate.findMany({ where: { orgId: org.id, channel: "EMAIL" }, select: { key: true } });
  const existingA = await prisma.messageAutomation.findMany({ where: { orgId: org.id, channel: "EMAIL" }, select: { templateKey: true, triggerEvent: true, isActive: true } });
  const accounts = await prisma.messagingAccount.findMany({ where: { orgId: org.id, channel: "EMAIL" }, select: { provider: true, mode: true } });

  const newT = TEMPLATES.filter((t) => !existingT.some((e) => e.key === t.key));
  const newA = AUTOMATIONS.filter((a) => !existingA.some((e) => e.templateKey === a.templateKey && e.triggerEvent === a.triggerEvent));
  console.log(`Org: ${org.name}`);
  console.log(`Email templates now: ${existingT.map((t) => t.key).join(", ") || "none"}  → add: ${newT.map((t) => t.key).join(", ") || "nothing"}`);
  console.log(`Email automations now: ${existingA.map((a) => `${a.templateKey}${a.isActive ? "" : " (off)"}`).join(", ") || "none"}  → add: ${newA.map((a) => `${a.templateKey} on ${a.triggerEvent}`).join(", ") || "nothing"}`);
  console.log(`Email account now: ${accounts.map((a) => `${a.provider}/${a.mode}`).join(", ") || "none (→ test mode)"}  → smtp/live`);
  if (!APPLY) { console.log("\nDRY RUN — nothing written. Re-run with CONFIRM=YES to apply."); return; }

  await runWithSystemContext(org.id, async () => {
    await prisma.$transaction(async (tx) => {
      for (const t of newT)
        await tx.messageTemplate.create({ data: { orgId: org.id, key: t.key, channel: "EMAIL", language: "en", body: t.body, isActive: true } });
      for (const a of newA)
        await tx.messageAutomation.create({ data: { orgId: org.id, category: a.category, triggerEvent: a.triggerEvent, templateKey: a.templateKey, channel: "EMAIL", isActive: true } });
      // One live email account: the SMTP adapter. Any other EMAIL row back to sandbox.
      await tx.messagingAccount.updateMany({ where: { orgId: org.id, channel: "EMAIL", provider: { not: "smtp" } }, data: { mode: "sandbox" } });
      await tx.messagingAccount.upsert({
        where: { orgId_channel_provider: { orgId: org.id, channel: "EMAIL", provider: "smtp" } },
        create: { orgId: org.id, channel: "EMAIL", provider: "smtp", mode: "live", config: {} },
        update: { mode: "live" },
      });
      await tx.auditLog.create({
        data: {
          orgId: org.id, action: "integration:set-messaging-mode", entityType: "MessagingAccount", entityId: `${org.id}:EMAIL:smtp`,
          reason: "Go-live guest email over SMTP (client's mailbox + app password) — script",
          before: { accounts }, after: { mode: "live", provider: "smtp", templatesAdded: newT.map((t) => t.key), automationsAdded: newA.map((a) => a.templateKey) },
        },
      });
    });
  });
  console.log("✅ Email is LIVE over SMTP; templates + automations in place.");
}
main().catch((e) => { console.error("Failed:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
