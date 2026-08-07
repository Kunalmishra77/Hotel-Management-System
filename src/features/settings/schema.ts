import { z } from "zod";
import { RoleName } from "@prisma/client";

/** Org security settings edit (16). Bounds mirror the seed defaults + sane limits. */
export const updateSecuritySettingsSchema = z.object({
  passwordMinLength: z.coerce.number().int().min(8).max(64),
  lockoutThreshold: z.coerce.number().int().min(3).max(20),
  sessionTtlMinutes: z.coerce.number().int().min(15).max(10_080), // 15 min … 7 days
  discountThresholdPaise: z.coerce.number().int().min(0),
  enforced2faRoles: z.array(z.nativeEnum(RoleName)).default([]),
});
export type UpdateSecuritySettingsInput = z.infer<typeof updateSecuritySettingsSchema>;
