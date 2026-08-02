/**
 * Communications event consumer — 12 T-8/T-17 (FR-3/FR-13/FR-20, AC-1/15/16).
 *
 * Registered on 00's dispatcher (worker). For a matching active automation it
 * resolves the template, renders with the event context + §11 property merge
 * fields, and enqueues a QUEUED MessageLog via the outbox — NEVER sending inline
 * on the originating request path.
 *
 * PaymentDueDetected is special: both 06 (checkout) and 14 (night-audit) emit it
 * for the same folio/day, so the reminder is idempotent per (folioId,
 * businessDate) via a durable IntegrationInbox key — at most one reminder per
 * folio per day, on top of the dispatcher's per-event-id dedupe.
 */
import { Prisma } from "@prisma/client";
import { runWithSystemContext } from "@/lib/context";
import { registerConsumer, type EventConsumer, type EventEnvelope } from "@/lib/events/dispatch";
import { logger } from "@/lib/logger";
import { isMarketingAllowed } from "../domain/consent";
import { candidateChannels, selectChannelAndLanguage } from "../domain/channel";
import { nextAllowedSendTime } from "../domain/quiet-hours";
import { buildRenderContext, renderAndEnqueue } from "../outbox";
import {
  activeAutomationsForEvent,
  commsDb,
  loadConsentStatus,
  loadGuest,
  loadProperty,
  resolveTemplate,
  resolveToAddress,
  templatesForKey,
  type GuestContact,
  type PropertyMerge,
} from "../internal";
import type { MessageAutomation } from "@prisma/client";

/** The domain events comms turns into messages (design.md § Events). */
const CONSUMED = [
  "ReservationCreated",
  "ReservationModified",
  "ReservationCancelled",
  "GuestCheckedIn",
  "GuestCheckedOut",
  "PaymentReceived",
  "InvoiceIssued",
  "PaymentDueDetected",
  "MaintenanceScheduled",
  "LowStockDetected",
  "NightAuditCompleted",
] as const;

const REMINDER_INBOX_PROVIDER = "comms:payment-reminder";
const DEFAULT_TZ = "Asia/Kolkata";

function payloadOf(envelope: EventEnvelope): Record<string, unknown> {
  return (envelope.payload ?? {}) as Record<string, unknown>;
}
function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Enqueue one message for a triggered automation (all gating applied). */
async function enqueueForAutomation(args: {
  orgId: string;
  automation: MessageAutomation;
  guest: GuestContact;
  guestId: string;
  property: PropertyMerge | null;
  propertyId: string | null;
  payload: Record<string, unknown>;
}): Promise<void> {
  const { orgId, automation, guest, guestId, property, propertyId, payload } = args;

  const templates = await templatesForKey(orgId, automation.templateKey);
  const sel = selectChannelAndLanguage(
    [automation.channel],
    "en",
    templates.map((t) => ({ channel: t.channel, language: t.language })),
  );
  if (!sel) {
    logger.info("comms.no_template", { key: automation.templateKey, channel: automation.channel });
    return; // FR-17: no active template ⇒ nothing generated
  }

  if (automation.category === "MARKETING") {
    const status = await loadConsentStatus(guestId, sel.channel);
    if (!isMarketingAllowed("MARKETING", status)) {
      logger.info("comms.marketing_suppressed", { guestId, channel: sel.channel });
      return; // FR-10
    }
  }

  const toAddress = resolveToAddress(sel.channel, guest);
  if (!toAddress) {
    logger.info("comms.no_address", { channel: sel.channel }); // never log the address
    return;
  }

  const template = await resolveTemplate(orgId, automation.templateKey, sel.channel, sel.language);
  if (!template) return;

  const allowedAt = nextAllowedSendTime(
    new Date(),
    { start: property?.quietHoursStart, end: property?.quietHoursEnd },
    automation.category,
    property?.timezone ?? DEFAULT_TZ,
  );
  const scheduledFor = allowedAt.getTime() > Date.now() ? allowedAt : null; // FR-21

  const context = buildRenderContext(guest, property, payload);
  await commsDb().$transaction((tx) =>
    renderAndEnqueue(tx, {
      propertyId,
      guestId,
      channel: sel.channel,
      category: automation.category,
      templateKey: automation.templateKey,
      toAddress,
      body: template.body,
      context,
      scheduledFor,
    }),
  );
}

async function handleTriggered(envelope: EventEnvelope): Promise<void> {
  const orgId = envelope.orgId;
  const automations = await activeAutomationsForEvent(orgId, envelope.type);
  if (automations.length === 0) return;

  const payload = payloadOf(envelope);
  const guestId = str(payload.guestId);
  const propertyId = str(payload.propertyId) ?? envelope.propertyId;
  if (!guestId) {
    logger.info("comms.no_guest_in_event", { type: envelope.type });
    return;
  }

  const guest = await loadGuest(orgId, guestId);
  if (!guest) return;
  const property = propertyId ? await loadProperty(propertyId) : null;

  for (const automation of automations) {
    await enqueueForAutomation({ orgId, automation, guest, guestId, property, propertyId, payload });
  }
}

/** PaymentDueDetected → one templated reminder per (folio, businessDate) (FR-20). */
async function handlePaymentDue(envelope: EventEnvelope): Promise<void> {
  const orgId = envelope.orgId;
  const payload = payloadOf(envelope);
  const folioId = envelope.aggregateId;
  const businessDate = str(payload.businessDate) ?? envelope.occurredAt.toISOString().slice(0, 10);
  const guestId = str(payload.guestId);
  const propertyId = str(payload.propertyId) ?? envelope.propertyId;
  if (!guestId) return;

  const guest = await loadGuest(orgId, guestId);
  if (!guest) return;
  const property = propertyId ? await loadProperty(propertyId) : null;

  // Choose the first channel with a PAYMENT_REMINDER template + a usable address.
  const templates = await templatesForKey(orgId, "PAYMENT_REMINDER");
  let chosen: { channel: (typeof templates)[number]["channel"]; language: string; toAddress: string; body: string } | null = null;
  for (const ch of candidateChannels(null, ["WHATSAPP", "EMAIL", "SMS"])) {
    const sel = selectChannelAndLanguage([ch], "en", templates.map((t) => ({ channel: t.channel, language: t.language })));
    if (!sel) continue;
    const toAddress = resolveToAddress(sel.channel, guest);
    if (!toAddress) continue;
    const template = await resolveTemplate(orgId, "PAYMENT_REMINDER", sel.channel, sel.language);
    if (!template) continue;
    chosen = { channel: sel.channel, language: sel.language, toAddress, body: template.body };
    break;
  }
  if (!chosen) {
    logger.info("comms.reminder_no_channel", { folioId });
    return;
  }

  const context = buildRenderContext(guest, property, payload);
  const key = `${folioId}:${businessDate}`;

  // Durable idempotency across 06 + 14 emitters and process restarts — a
  // standalone insert (its own tx) so a duplicate never aborts the enqueue tx.
  try {
    await commsDb().integrationInbox.create({
      data: { provider: REMINDER_INBOX_PROVIDER, externalId: key, type: "PaymentDueDetected", payload: {}, processedAt: new Date() },
      select: { id: true },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      logger.info("comms.reminder_deduped", { key });
      return; // already reminded for this folio/day
    }
    throw e;
  }

  await commsDb().$transaction((tx) =>
    renderAndEnqueue(tx, {
      propertyId,
      guestId,
      channel: chosen!.channel,
      category: null, // transactional reminder — no consent/quiet-hours gate
      templateKey: "PAYMENT_REMINDER",
      toAddress: chosen!.toAddress,
      body: chosen!.body,
      context,
      scheduledFor: null,
    }),
  );
}

export const communicationsConsumer: EventConsumer = {
  name: "communications",
  types: CONSUMED,
  async handle(envelope) {
    await runWithSystemContext(envelope.orgId, async () => {
      if (envelope.type === "PaymentDueDetected") return handlePaymentDue(envelope);
      return handleTriggered(envelope);
    });
  },
};

let registered = false;
/** Register the comms consumer with the dispatcher (idempotent). */
export function registerCommunicationsConsumer(): void {
  if (registered) return;
  registerConsumer(communicationsConsumer);
  registered = true;
}
