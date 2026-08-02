/**
 * Messaging worker — 12 T-9/T-10/T-12 (FR-4/5/7/9, AC-2/3/4/7).
 *
 * `dispatchQueuedMessages` sends QUEUED MessageLogs via the resolved
 * MessagingProvider. Sandbox (mock) makes NO external call and advances the
 * status QUEUED→SENT→DELIVERED deterministically (FR-4). Live calls
 * `sendTemplate`; success → SENT + providerRef (DELIVERED arrives by webhook),
 * error → retry with backoff, dead-letter + admin alert on exhaustion (FR-7). A
 * live WhatsApp/SMS send without an approved providerTemplateId is blocked (FR-9).
 *
 * `scheduleTick` computes due scheduled sends idempotently per (reservation,
 * automation) (FR-13).
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { runWithSystemContext } from "@/lib/context";
import { writeAudit } from "@/lib/audit";
import { alertAdmin } from "@/lib/alerts";
import { logger } from "@/lib/logger";
import { resolveMessagingProvider, type OutboundMessage } from "@/lib/messaging";
import type { MessagingAccountConfig } from "@/lib/messaging";
import { dueScheduledSends } from "./domain/schedule";
import { buildRenderContext, renderAndEnqueue } from "./outbox";
import { loadGuest, loadProperty, resolveToAddress, templatesForKey } from "./internal";

/** Retry a failing live send this many times before dead-lettering (FR-7). */
export const MAX_SEND_ATTEMPTS = 5;

const LIVE_TEMPLATE_CHANNELS = new Set(["WHATSAPP", "SMS"]);

export type DispatchResult = { fetched: number; sent: number; failed: number; deadLettered: number; blocked: number };

export async function dispatchQueuedMessages(
  db: PrismaClient,
  options: { now?: Date; batchSize?: number } = {},
): Promise<DispatchResult> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? 100;

  const rows = await db.messageLog.findMany({
    where: {
      status: "QUEUED",
      deadLetteredAt: null,
      OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: batchSize,
  });

  const result: DispatchResult = { fetched: rows.length, sent: 0, failed: 0, deadLettered: 0, blocked: 0 };

  for (const row of rows) {
    // The rendered body + orgId live on the triggering MessageQueued event.
    const event = row.triggeredByEvent
      ? await db.domainEvent.findUnique({ where: { id: row.triggeredByEvent }, select: { orgId: true, payload: true } })
      : null;
    if (!event) {
      await db.messageLog.update({ where: { id: row.id }, data: { status: "FAILED", error: "MISSING_BODY_EVENT", deadLetteredAt: now } });
      result.deadLettered += 1;
      continue;
    }
    const orgId = event.orgId;
    const body = String((event.payload as Record<string, unknown>)?.body ?? "");

    const account = await db.messagingAccount.findFirst({ where: { orgId, channel: row.channel } });
    const provider = resolveMessagingProvider(
      account ? { channel: account.channel, provider: account.provider, mode: account.mode, config: account.config as unknown as MessagingAccountConfig } : null,
    );

    // FR-9: live WhatsApp/SMS requires an approved providerTemplateId.
    let providerTemplateId: string | null = null;
    if (row.templateKey) {
      const templates = await templatesForKey(orgId, row.templateKey);
      providerTemplateId = templates.find((t) => t.channel === row.channel && t.providerTemplateId)?.providerTemplateId ?? null;
    }
    if (provider.isLive && LIVE_TEMPLATE_CHANNELS.has(row.channel) && !providerTemplateId) {
      await runWithSystemContext(orgId, () =>
        db.$transaction(async (tx) => {
          await tx.messageLog.update({ where: { id: row.id }, data: { status: "FAILED", error: "TEMPLATE_NOT_APPROVED", deadLetteredAt: now } });
          await writeAudit(tx, { action: "communication:send", entityType: "MessageLog", entityId: row.id, propertyId: row.propertyId, orgId, after: { status: "FAILED", error: "TEMPLATE_NOT_APPROVED" } });
        }),
      );
      result.blocked += 1;
      continue;
    }

    const message: OutboundMessage = { channel: row.channel, toAddress: row.toAddress, body, providerTemplateId, templateKey: row.templateKey };
    const send = await provider.sendTemplate(message);

    if (send.ok) {
      // Sandbox (mock) is not live → deterministic DELIVERED with no webhook.
      const finalStatus = provider.isLive ? "SENT" : "DELIVERED";
      await runWithSystemContext(orgId, () =>
        db.$transaction(async (tx) => {
          await tx.messageLog.update({ where: { id: row.id }, data: { status: finalStatus, providerRef: send.providerRef, error: null, attempts: row.attempts + 1 } });
          await writeAudit(tx, { action: "communication:send", entityType: "MessageLog", entityId: row.id, propertyId: row.propertyId, orgId, after: { status: finalStatus } });
        }),
      );
      result.sent += 1;
      continue;
    }

    // Failure: retry with backoff (leave QUEUED) until the cap, then dead-letter.
    const attempts = row.attempts + 1;
    const deadLetter = attempts >= MAX_SEND_ATTEMPTS;
    await runWithSystemContext(orgId, () =>
      db.$transaction(async (tx) => {
        await tx.messageLog.update({
          where: { id: row.id },
          data: { status: deadLetter ? "FAILED" : "QUEUED", error: send.error, attempts, deadLetteredAt: deadLetter ? now : null },
        });
        if (deadLetter) {
          await writeAudit(tx, { action: "communication:send", entityType: "MessageLog", entityId: row.id, propertyId: row.propertyId, orgId, after: { status: "FAILED", attempts } });
        }
      }),
    );
    result.failed += 1;
    if (deadLetter) {
      result.deadLettered += 1;
      await alertAdmin({ severity: "warning", code: "comms.dead_letter", title: "A message could not be delivered", detail: { messageLogId: row.id, channel: row.channel, attempts } });
    }
  }

  return result;
}

export type ScheduleTickResult = { automations: number; due: number; enqueued: number };

/** Anchor field per category: check-in for before/during, check-out for after. */
function anchorFor(category: string, r: { checkInDate: Date; checkOutDate: Date; checkInAt: Date | null; checkOutAt: Date | null }): Date {
  if (category === "AFTER_CHECKOUT") return r.checkOutAt ?? r.checkOutDate;
  return r.checkInAt ?? r.checkInDate;
}

export async function scheduleTick(db: PrismaClient, options: { now?: Date } = {}): Promise<ScheduleTickResult> {
  const now = options.now ?? new Date();
  const automations = await db.messageAutomation.findMany({ where: { isActive: true, triggerEvent: null, scheduleOffsetMinutes: { not: null } } });
  const result: ScheduleTickResult = { automations: automations.length, due: 0, enqueued: 0 };

  for (const automation of automations) {
    const orgId = automation.orgId;
    const offset = automation.scheduleOffsetMinutes ?? 0;
    const afterCheckout = automation.category === "AFTER_CHECKOUT";
    const statuses = afterCheckout ? (["CHECKED_OUT", "IN_HOUSE"] as const) : (["CONFIRMED", "IN_HOUSE"] as const);

    const reservations = await db.reservation.findMany({
      where: { property: { orgId }, status: { in: [...statuses] } },
      select: { id: true, guestId: true, propertyId: true, checkInDate: true, checkOutDate: true, checkInAt: true, checkOutAt: true },
      take: 2_000,
    });

    const due = dueScheduledSends({
      reservations: reservations.map((r) => ({ reservationId: r.id, guestId: r.guestId, anchor: anchorFor(automation.category, r) })),
      offsetMinutes: offset,
      now,
    });
    result.due += due.length;

    const byId = new Map(reservations.map((r) => [r.id, r]));
    const templates = await templatesForKey(orgId, automation.templateKey);
    const template = templates.find((t) => t.channel === automation.channel && t.language === "en") ?? templates.find((t) => t.channel === automation.channel);
    if (!template) continue;

    for (const send of due) {
      const reservation = byId.get(send.reservationId);
      if (!reservation) continue;
      const guest = await loadGuest(orgId, send.guestId);
      if (!guest) continue;
      const toAddress = resolveToAddress(automation.channel, guest);
      if (!toAddress) continue;
      const property = await loadProperty(reservation.propertyId);
      const context = buildRenderContext(guest, property, {
        checkInDate: reservation.checkInDate.toISOString().slice(0, 10),
        checkOutDate: reservation.checkOutDate.toISOString().slice(0, 10),
      });

      const key = `comms:schedule:${automation.id}:${send.reservationId}`;
      // Idempotency per (automation, reservation) — standalone insert first.
      try {
        await db.integrationInbox.create({ data: { provider: "comms:schedule", externalId: key, type: "ScheduledSend", payload: {}, processedAt: now }, select: { id: true } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
        throw e;
      }
      await runWithSystemContext(orgId, () =>
        db.$transaction((tx) =>
          renderAndEnqueue(tx, {
            propertyId: reservation.propertyId,
            guestId: send.guestId,
            channel: automation.channel,
            category: automation.category,
            templateKey: automation.templateKey,
            toAddress,
            body: template.body,
            context,
            scheduledFor: null,
          }),
        ),
      );
      result.enqueued += 1;
    }
  }

  logger.info("comms.schedule_tick", { ...result });
  return result;
}
