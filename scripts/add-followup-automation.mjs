/**
 * One-time go-live helper: add the +10-day post-checkout follow-up (client req #25)
 * to the LIVE database without re-running the full seed. Idempotent — upserts the
 * FOLLOWUP_10D templates (Email + WhatsApp) and the two scheduled automations, so
 * running it more than once is safe.
 *
 * The scheduler (scheduleTick / anchorFor) already handles an AFTER_CHECKOUT
 * anchor, so once these rows exist the worker sends the follow-up 10 days after
 * each check-out: Email over SMTP once the EMAIL account is live; WhatsApp stays
 * sandbox until the WABA/BSP + HSM template are approved.
 *
 * Usage (against whichever DB the env points to):
 *   node scripts/add-followup-automation.mjs
 */
import { PrismaClient } from "@prisma/client";

const ORG_ID = "org_woodpecker";
const prisma = new PrismaClient();

const templates = [
  { key: "FOLLOWUP_10D", channel: "EMAIL", language: "en", providerTemplateId: null, body: "Dear {{guestName}},\n\nIt has been a little while since your stay at {{propertyName}} — we hope you are doing well. If you are planning another visit to the city, we would love to host you again, and are happy to arrange your preferred apartment.\n\nJust reply to this email or call us to book.\n\nWarm regards,\n{{propertyName}}" },
  { key: "FOLLOWUP_10D", channel: "WHATSAPP", language: "en", providerTemplateId: "hsm_followup_10d_en", body: "Hi {{guestName}}, we hope you enjoyed your stay at {{propertyName}}! Planning another trip? Reply here and we'll arrange your apartment again." },
];

const automations = [
  { id: "auto_followup_10d_email", category: "AFTER_CHECKOUT", triggerEvent: null, scheduleOffsetMinutes: 14400, templateKey: "FOLLOWUP_10D", channel: "EMAIL" },
  { id: "auto_followup_10d_whatsapp", category: "AFTER_CHECKOUT", triggerEvent: null, scheduleOffsetMinutes: 14400, templateKey: "FOLLOWUP_10D", channel: "WHATSAPP" },
];

try {
  for (const t of templates) {
    await prisma.messageTemplate.upsert({
      where: { orgId_key_channel_language: { orgId: ORG_ID, key: t.key, channel: t.channel, language: t.language } },
      create: { orgId: ORG_ID, ...t, isActive: true },
      update: { body: t.body, providerTemplateId: t.providerTemplateId, isActive: true },
    });
    console.log(`template upserted: ${t.key}/${t.channel}`);
  }
  for (const a of automations) {
    const { id, ...rest } = a;
    await prisma.messageAutomation.upsert({
      where: { id },
      create: { id, orgId: ORG_ID, isActive: true, ...rest },
      update: { ...rest, isActive: true },
    });
    console.log(`automation upserted: ${id}`);
  }
  console.log("\n✅ +10-day follow-up added. The worker will send it 10 days after each check-out.");
} catch (e) {
  console.error("Failed:", e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
