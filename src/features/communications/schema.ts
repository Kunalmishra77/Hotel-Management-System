/** Zod boundary schemas for 12-communications (api-conventions.md). */
import { z } from "zod";

const channel = z.enum(["WHATSAPP", "EMAIL", "SMS"]);
const category = z.enum(["BEFORE_ARRIVAL", "DURING_STAY", "AFTER_CHECKOUT", "MARKETING"]);
const consentStatus = z.enum(["GRANTED", "OPTED_OUT"]);

/** A flat merge context — values are coerced to string at render time. */
const renderContext = z.record(z.union([z.string(), z.number(), z.null()])).optional();

export const manageTemplateSchema = z.object({
  id: z.string().min(1).optional(),
  key: z.string().min(1).max(80),
  channel,
  language: z.string().min(2).max(10).default("en"),
  body: z.string().min(1).max(4000),
  providerTemplateId: z.string().max(200).nullish(),
  isActive: z.boolean().optional(),
});
export type ManageTemplateInput = z.infer<typeof manageTemplateSchema>;

export const manageAutomationSchema = z
  .object({
    id: z.string().min(1).optional(),
    category,
    triggerEvent: z.string().min(1).max(80).nullish(),
    scheduleOffsetMinutes: z.number().int().min(-100_000).max(100_000).nullish(),
    templateKey: z.string().min(1).max(80),
    channel,
    audienceFilter: z.record(z.unknown()).nullish(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.triggerEvent) !== (v.scheduleOffsetMinutes !== null && v.scheduleOffsetMinutes !== undefined), {
    message: "Provide exactly one of triggerEvent or scheduleOffsetMinutes.",
    path: ["triggerEvent"],
  });
export type ManageAutomationInput = z.infer<typeof manageAutomationSchema>;

export const launchCampaignSchema = z
  .object({
    templateKey: z.string().min(1).max(80),
    channel,
    segmentRef: z.string().max(120).nullish(),
    /** Target an AI guest segment — the server resolves its cached membership. */
    segmentId: z.string().min(1).nullish(),
    couponId: z.string().min(1).nullish(),
    language: z.string().min(2).max(10).default("en"),
    /** Explicit recipient set (used when no segmentId is given). */
    recipientGuestIds: z.array(z.string().min(1)).max(10_000).default([]),
    propertyId: z.string().min(1).nullish(),
  })
  // Either a segment or an explicit recipient list must target the campaign.
  .refine((d) => Boolean(d.segmentId) || d.recipientGuestIds.length > 0, {
    message: "Pick a segment or at least one recipient.",
    path: ["recipientGuestIds"],
  });
export type LaunchCampaignInput = z.infer<typeof launchCampaignSchema>;

export const sendManualSchema = z.object({
  guestId: z.string().min(1),
  propertyId: z.string().min(1),
  templateKey: z.string().min(1).max(80),
  channel,
  language: z.string().min(2).max(10).default("en"),
  context: renderContext,
});
export type SendManualInput = z.infer<typeof sendManualSchema>;

export const setConsentSchema = z.object({
  guestId: z.string().min(1),
  channel,
  marketingStatus: consentStatus,
});
export type SetConsentInput = z.infer<typeof setConsentSchema>;

export const captureFeedbackSchema = z.object({
  guestId: z.string().min(1),
  propertyId: z.string().min(1),
  rating: z.number().int().min(1).max(5).nullish(),
  comment: z.string().max(4000).nullish(),
  source: z.string().max(60).default("post-checkout"),
});
export type CaptureFeedbackInput = z.infer<typeof captureFeedbackSchema>;

export const recordSentimentSchema = z.object({
  feedbackId: z.string().min(1),
  label: z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]),
  score: z.number().min(-1).max(1),
});
export type RecordSentimentInput = z.infer<typeof recordSentimentSchema>;
