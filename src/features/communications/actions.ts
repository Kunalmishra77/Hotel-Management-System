"use server";

/**
 * 12-communications actions — T-14/T-16/T-18 (FR-14/16/19, AC-12/14/17).
 *
 * Canonical write path throughout: zod.parse → requireUser → authorize
 * (property/org-scoped) → transaction → emit event + audit → typed Result.
 * Sending is NEVER inline here — an enqueue writes a QUEUED MessageLog and the
 * messaging worker dispatches it off the request path.
 *
 * `recordSentiment` is the cross-module contract 18 calls to write a sentiment
 * label onto the Feedback this module owns (18 never writes Feedback directly).
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import type { Prisma } from "@prisma/client";
import { segmentGuestIds } from "@/features/ai/queries";
import { isMarketingAllowed } from "./domain/consent";
import { nextAllowedSendTime } from "./domain/quiet-hours";
import { buildRenderContext, renderAndEnqueue } from "./outbox";
import { createFeedback } from "./webhook";
import {
  commsDb,
  loadConsentStatus,
  loadGuest,
  loadProperty,
  resolveTemplate,
  resolveToAddress,
  withCommsContext,
} from "./internal";
import {
  captureFeedbackSchema,
  launchCampaignSchema,
  manageAutomationSchema,
  manageTemplateSchema,
  recordSentimentSchema,
  sendManualSchema,
  setConsentSchema,
} from "./schema";

/** Resolve a template for a key+channel, preferring `language`, falling back to en. */
async function resolveWithFallback(orgId: string, key: string, channel: "WHATSAPP" | "EMAIL" | "SMS", language: string) {
  return (await resolveTemplate(orgId, key, channel, language)) ?? (await resolveTemplate(orgId, key, channel, "en"));
}

/** Create/update a message template (FR-2/19). */
export async function manageTemplate(input: unknown): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    const data = manageTemplateSchema.parse(input);
    const user = await requireUser();
    authorize(user, "communication:template-manage", null);

    return withCommsContext(user, () =>
      commsDb().$transaction(async (tx) => {
        const row = await tx.messageTemplate.upsert({
          where: { orgId_key_channel_language: { orgId: user.orgId, key: data.key, channel: data.channel, language: data.language } },
          create: { orgId: user.orgId, key: data.key, channel: data.channel, language: data.language, body: data.body, providerTemplateId: data.providerTemplateId ?? null, isActive: data.isActive ?? true },
          update: { body: data.body, providerTemplateId: data.providerTemplateId ?? null, ...(data.isActive === undefined ? {} : { isActive: data.isActive }) },
          select: { id: true },
        });
        await writeAudit(tx, { action: "communication:template-manage", entityType: "MessageTemplate", entityId: row.id, after: { key: data.key, channel: data.channel, language: data.language, isActive: data.isActive ?? true } });
        return { id: row.id };
      }),
    );
  });
}

/** Create/update an automation (FR-12/19). */
export async function manageAutomation(input: unknown): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    const data = manageAutomationSchema.parse(input);
    const user = await requireUser();
    authorize(user, "communication:template-manage", null);

    return withCommsContext(user, () =>
      commsDb().$transaction(async (tx) => {
        const base = {
          category: data.category,
          triggerEvent: data.triggerEvent ?? null,
          scheduleOffsetMinutes: data.scheduleOffsetMinutes ?? null,
          templateKey: data.templateKey,
          channel: data.channel,
          ...(data.audienceFilter ? { audienceFilter: data.audienceFilter as Prisma.InputJsonValue } : {}),
          ...(data.isActive === undefined ? {} : { isActive: data.isActive }),
        };
        const row = data.id
          ? await tx.messageAutomation.update({ where: { id: data.id }, data: base, select: { id: true } })
          : await tx.messageAutomation.create({ data: { orgId: user.orgId, ...base, isActive: data.isActive ?? true }, select: { id: true } });
        await writeAudit(tx, { action: "communication:template-manage", entityType: "MessageAutomation", entityId: row.id, after: { category: data.category, templateKey: data.templateKey, channel: data.channel } });
        return { id: row.id };
      }),
    );
  });
}

/** Approve + fan out a marketing campaign: one MessageLog per eligible recipient (FR-14). */
export async function launchCampaign(input: unknown): Promise<Result<{ campaignId: string; enqueued: number; skipped: number }>> {
  return toResult(async () => {
    const data = launchCampaignSchema.parse(input);
    const user = await requireUser();
    authorize(user, "communication:template-manage", data.propertyId ?? null);

    // §11 coupon: a paused/expired coupon is never sent (FR-25).
    let couponCode: string | null = null;
    if (data.couponId) {
      const coupon = await commsDb().coupon.findFirst({ where: { id: data.couponId, orgId: user.orgId }, select: { code: true, status: true, validFrom: true, validTo: true } });
      const now = new Date();
      if (!coupon || coupon.status !== "ACTIVE" || coupon.validFrom > now || coupon.validTo < now) {
        throw new DomainError(ErrorCode.COUPON_INVALID, "Coupon is not active/valid for a campaign");
      }
      couponCode = coupon.code;
    }

    const template = await resolveWithFallback(user.orgId, data.templateKey, data.channel, data.language);
    if (!template) throw new NotFoundError("No active template for that key/channel.");
    const property = data.propertyId ? await loadProperty(data.propertyId) : null;

    // Resolve the recipient set: an AI segment's cached membership (12 marketing
    // targets a segment), or the explicit list. Consent is still evaluated per
    // recipient below — a segment never bypasses opt-out.
    const recipients = data.segmentId ? await segmentGuestIds(user, data.segmentId) : data.recipientGuestIds;
    if (recipients.length === 0) throw new NotFoundError("The segment has no members to send to.");

    let enqueued = 0;
    let skipped = 0;
    const campaignId = await withCommsContext(user, async () => {
      const campaign = await commsDb().campaign.create({
        data: { orgId: user.orgId, templateKey: data.templateKey, channel: data.channel, segmentRef: data.segmentRef ?? data.segmentId ?? null, couponId: data.couponId ?? null, status: "SENT", approvedById: user.userId, scheduledAt: new Date() },
        select: { id: true },
      });

      for (const guestId of recipients) {
        const guest = await loadGuest(user.orgId, guestId);
        if (!guest) { skipped += 1; continue; }
        const status = await loadConsentStatus(guestId, data.channel);
        if (!isMarketingAllowed("MARKETING", status)) { skipped += 1; continue; } // FR-10
        const toAddress = resolveToAddress(data.channel, guest);
        if (!toAddress) { skipped += 1; continue; }

        const allowedAt = nextAllowedSendTime(new Date(), { start: property?.quietHoursStart, end: property?.quietHoursEnd }, "MARKETING", property?.timezone ?? "Asia/Kolkata");
        const context = buildRenderContext(guest, property, {}, couponCode ? { couponCode } : {});
        await commsDb().$transaction((tx) =>
          renderAndEnqueue(tx, {
            propertyId: data.propertyId ?? null,
            guestId,
            channel: data.channel,
            category: "MARKETING",
            templateKey: data.templateKey,
            toAddress,
            body: template.body,
            context,
            scheduledFor: allowedAt.getTime() > Date.now() ? allowedAt : null,
          }),
        );
        enqueued += 1;
      }

      await commsDb().$transaction((tx) => writeAudit(tx, { action: "communication:template-manage", entityType: "Campaign", entityId: campaign.id, propertyId: data.propertyId ?? null, after: { templateKey: data.templateKey, channel: data.channel, enqueued, skipped } }));
      return campaign.id;
    });

    return { campaignId, enqueued, skipped };
  });
}

/** Manually send a single transactional message (FR-19, communication:send). */
export async function sendManual(input: unknown): Promise<Result<{ messageLogId: string; deadLettered: boolean }>> {
  return toResult(async () => {
    const data = sendManualSchema.parse(input);
    const user = await requireUser();
    authorize(user, "communication:send", data.propertyId);

    const guest = await loadGuest(user.orgId, data.guestId);
    if (!guest) throw new NotFoundError("Guest not found.");
    const template = await resolveWithFallback(user.orgId, data.templateKey, data.channel, data.language);
    if (!template) throw new NotFoundError("No active template for that key/channel.");
    const toAddress = resolveToAddress(data.channel, guest);
    if (!toAddress) throw new DomainError(ErrorCode.VALIDATION_FAILED, "Guest has no address for that channel.");

    const property = await loadProperty(data.propertyId);
    const context = buildRenderContext(guest, property, {}, data.context ?? {});

    return withCommsContext(user, () =>
      commsDb().$transaction(async (tx) => {
        const { id, deadLettered } = await renderAndEnqueue(tx, {
          propertyId: data.propertyId,
          guestId: data.guestId,
          channel: data.channel,
          category: null,
          templateKey: data.templateKey,
          toAddress,
          body: template.body,
          context,
          scheduledFor: null,
        });
        return { messageLogId: id, deadLettered };
      }),
    );
  });
}

/** Set marketing consent for a guest/channel (FR-11/19). */
export async function setConsent(input: unknown): Promise<Result<{ guestId: string; channel: string; marketingStatus: string }>> {
  return toResult(async () => {
    const data = setConsentSchema.parse(input);
    const user = await requireUser();
    authorize(user, "communication:send", null);

    return withCommsContext(user, () =>
      commsDb().$transaction(async (tx) => {
        await tx.communicationConsent.upsert({
          where: { guestId_channel: { guestId: data.guestId, channel: data.channel } },
          create: { guestId: data.guestId, channel: data.channel, marketingStatus: data.marketingStatus },
          update: { marketingStatus: data.marketingStatus },
        });
        await emitEvent(tx, { type: "ConsentChanged", aggregateId: data.guestId, payload: { channel: data.channel, marketingStatus: data.marketingStatus } });
        await writeAudit(tx, { action: "communication:send", entityType: "CommunicationConsent", entityId: `${data.guestId}:${data.channel}`, after: { channel: data.channel, marketingStatus: data.marketingStatus } });
        return { guestId: data.guestId, channel: data.channel, marketingStatus: data.marketingStatus };
      }),
    );
  });
}

/** Capture guest feedback → Feedback + FeedbackReceived (FR-16, AC-14). */
export async function captureFeedback(input: unknown): Promise<Result<{ feedbackId: string }>> {
  return toResult(async () => {
    const data = captureFeedbackSchema.parse(input);
    const user = await requireUser();
    authorize(user, "communication:send", data.propertyId);

    return withCommsContext(user, () =>
      commsDb().$transaction(async (tx) => {
        const feedbackId = await createFeedback(tx, { guestId: data.guestId, propertyId: data.propertyId, rating: data.rating ?? null, comment: data.comment ?? null, source: data.source });
        return { feedbackId };
      }),
    );
  });
}

/**
 * CROSS-MODULE CONTRACT — 18-ai calls this to write a sentiment label onto the
 * Feedback this module owns (FR-16). 18 never writes Feedback directly.
 */
export async function recordSentiment(input: unknown): Promise<Result<{ feedbackId: string; label: string; score: number }>> {
  return toResult(async () => {
    const data = recordSentimentSchema.parse(input);
    const user = await requireUser();

    const feedback = await commsDb().feedback.findUnique({ where: { id: data.feedbackId }, select: { id: true, propertyId: true } });
    if (!feedback) throw new NotFoundError("Feedback not found.");
    authorize(user, "ai:use", feedback.propertyId);

    return withCommsContext(user, () =>
      commsDb().$transaction(async (tx) => {
        await tx.feedback.update({ where: { id: feedback.id }, data: { sentiment: data.label, sentimentScore: data.score } });
        await writeAudit(tx, { action: "ai:use", entityType: "Feedback", entityId: feedback.id, propertyId: feedback.propertyId, after: { sentiment: data.label, sentimentScore: data.score } });
        return { feedbackId: feedback.id, label: data.label, score: data.score };
      }),
    );
  });
}
