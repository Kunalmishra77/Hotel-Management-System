/**
 * Zod boundary for the integrations console (api-conventions.md). The one write
 * surface is the messaging channel mode toggle — everything else on the console
 * is read-only status.
 */
import { z } from "zod";
import { Channel } from "@prisma/client";

/**
 * Set (or create) a messaging channel's provider + mode. `mode` is the single
 * switch `resolveMessagingProvider` reads: anything but "live" resolves the mock
 * (integrations.md sandbox↔live gating). Going live is a data change, not code.
 */
export const setMessagingModeSchema = z.object({
  channel: z.nativeEnum(Channel),
  provider: z.string().min(1).max(60),
  mode: z.enum(["sandbox", "live"]),
});
export type SetMessagingModeInput = z.infer<typeof setMessagingModeSchema>;
