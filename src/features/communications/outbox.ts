/**
 * Outbox enqueue helpers — 12 (FR-3/FR-15/FR-18). NOT a "use server" module.
 *
 * The rendered body is carried on the emitted `MessageQueued` domain event's
 * payload (an append-only store), NOT on the MessageLog row — the MessageLog is
 * metadata only (the schema has no body column, by design). The messaging worker
 * re-reads that event to obtain the body at dispatch time, keeping sending fully
 * off the originating write path (FR-3).
 */
import { emitEvent } from "@/lib/events";
import { writeAudit } from "@/lib/audit";
import type { AutomationCategory, Channel, Prisma } from "@prisma/client";
import { renderTemplate, type RenderContext } from "./domain/render";
import type { GuestContact, PropertyMerge } from "./internal";

/** A Prisma tx client that can write a MessageLog + audit + event. */
type Tx = Prisma.TransactionClient;

/**
 * Build the flat render context: guest name, the §11 per-property merge fields
 * (FR-24), and any scalar values carried on the triggering event payload
 * (checkInDate, roomNumber, balanceDuePaise, invoiceNo, couponCode, …). Objects
 * and nested values on the payload are ignored — only primitives merge in.
 */
export function buildRenderContext(
  guest: Pick<GuestContact, "fullName"> | null,
  property: PropertyMerge | null,
  payload: Record<string, unknown> = {},
  extra: RenderContext = {},
): RenderContext {
  const ctx: RenderContext = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v === null) ctx[k] = null;
    else if (typeof v === "string" || typeof v === "number") ctx[k] = v;
    else if (typeof v === "bigint") ctx[k] = v.toString();
  }
  if (guest) ctx.guestName = guest.fullName;
  if (property) {
    ctx.propertyName = property.name;
    ctx.propertyCity = property.city;
    ctx.wifiSsid = property.wifiSsid;
    ctx.wifiPassword = property.wifiPassword;
    ctx.houseRules = property.houseRules;
    ctx.emergencyContact = property.emergencyContact;
    ctx.locationMapUrl = property.locationMapUrl;
    ctx.checkInInstructions = property.checkInInstructions;
  }
  return { ...ctx, ...extra };
}

export type EnqueueArgs = {
  propertyId: string | null;
  guestId: string | null;
  channel: Channel;
  category: AutomationCategory | null;
  templateKey: string;
  toAddress: string;
  body: string;
  scheduledFor?: Date | null;
};

/**
 * Enqueue a rendered message: create a QUEUED MessageLog, emit `MessageQueued`
 * (carrying the body for the worker), backfill `triggeredByEvent`, audit.
 * Returns the MessageLog id.
 */
export async function enqueueRendered(tx: Tx, args: EnqueueArgs): Promise<string> {
  const log = await tx.messageLog.create({
    data: {
      propertyId: args.propertyId,
      guestId: args.guestId,
      channel: args.channel,
      category: args.category,
      templateKey: args.templateKey,
      toAddress: args.toAddress,
      status: "QUEUED",
      scheduledFor: args.scheduledFor ?? null,
    },
    select: { id: true },
  });

  const eventId = await emitEvent(tx, {
    type: "MessageQueued",
    aggregateId: log.id,
    propertyId: args.propertyId,
    // body is content, not a log line — stored on the event for the worker.
    payload: { messageLogId: log.id, channel: args.channel, templateKey: args.templateKey, category: args.category, body: args.body },
  });

  await tx.messageLog.update({ where: { id: log.id }, data: { triggeredByEvent: eventId } });
  await writeAudit(tx, {
    action: "communication:send",
    entityType: "MessageLog",
    entityId: log.id,
    propertyId: args.propertyId,
    // No toAddress / body in the audit snapshot (FR-15 PII minimization).
    after: { channel: args.channel, templateKey: args.templateKey, category: args.category, status: "QUEUED" },
  });
  return log.id;
}

/**
 * Record a message that could not be rendered (FR-18/AC-16): a FAILED,
 * dead-lettered MessageLog with the error code — and NO send. Never a partial
 * or blank message reaches a guest.
 */
export async function deadLetterRender(
  tx: Tx,
  args: Omit<EnqueueArgs, "body" | "scheduledFor"> & { error: string },
): Promise<string> {
  const log = await tx.messageLog.create({
    data: {
      propertyId: args.propertyId,
      guestId: args.guestId,
      channel: args.channel,
      category: args.category,
      templateKey: args.templateKey,
      toAddress: args.toAddress,
      status: "FAILED",
      error: args.error,
      deadLetteredAt: new Date(),
    },
    select: { id: true },
  });
  await writeAudit(tx, {
    action: "communication:send",
    entityType: "MessageLog",
    entityId: log.id,
    propertyId: args.propertyId,
    after: { channel: args.channel, templateKey: args.templateKey, status: "FAILED", error: args.error },
  });
  return log.id;
}

/**
 * Render + enqueue in one step, dead-lettering on a missing variable. Returns the
 * MessageLog id and whether it was dead-lettered.
 */
export async function renderAndEnqueue(
  tx: Tx,
  args: Omit<EnqueueArgs, "body"> & { body: string; context: RenderContext },
): Promise<{ id: string; deadLettered: boolean }> {
  try {
    const rendered = renderTemplate(args.body, args.context);
    const id = await enqueueRendered(tx, { ...args, body: rendered });
    return { id, deadLettered: false };
  } catch (e) {
    // Re-throw non-render errors; only RENDER_MISSING_VAR dead-letters here.
    const code = (e as { code?: string })?.code;
    if (code !== "RENDER_MISSING_VAR") throw e;
    const id = await deadLetterRender(tx, {
      propertyId: args.propertyId,
      guestId: args.guestId,
      channel: args.channel,
      category: args.category,
      templateKey: args.templateKey,
      toAddress: args.toAddress,
      error: "RENDER_MISSING_VAR",
    });
    return { id, deadLettered: true };
  }
}
