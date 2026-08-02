/**
 * Channel action input schemas (zod) — 13. Validated at every action boundary
 * (api-conventions.md). Provider is a free string (an aggregator may forward
 * many); the mapping/activation rules live in the actions + domain.
 */
import { z } from "zod";

export const connectChannelSchema = z.object({
  propertyId: z.string().min(1),
  provider: z.string().min(1).max(64),
  /** Non-secret config; a webhook secret / credentials ref is set separately. */
  config: z.record(z.unknown()).default({}),
});
export type ConnectChannelInput = z.infer<typeof connectChannelSchema>;

export const mapRoomTypeSchema = z.object({
  channelAccountId: z.string().min(1),
  roomCategoryId: z.string().min(1),
  externalRoomType: z.string().min(1).max(120),
  externalRatePlan: z.string().max(120).optional(),
});
export type MapRoomTypeInput = z.infer<typeof mapRoomTypeSchema>;

export const activateChannelSchema = z.object({
  channelAccountId: z.string().min(1),
  /** The secret-store reference proving certification credentials were supplied. */
  credentialsRef: z.string().min(1).optional(),
});
export type ActivateChannelInput = z.infer<typeof activateChannelSchema>;

export const certifyChannelSchema = z.object({
  channelAccountId: z.string().min(1),
  credentialsRef: z.string().min(1),
});
export type CertifyChannelInput = z.infer<typeof certifyChannelSchema>;

export const resolveAttentionSchema = z.object({
  syncLogId: z.string().min(1),
});
