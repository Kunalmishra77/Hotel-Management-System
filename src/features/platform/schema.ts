/**
 * Zod schemas for the platform feature's server actions.
 * api-conventions.md: every input boundary is validated.
 */
import { z } from "zod";

export const switchPropertySchema = z.object({
  // null = "All hotels" (clear the single-property focus for a multi-property user).
  propertyId: z.string().min(1).nullable(),
});

export type SwitchPropertyInput = z.infer<typeof switchPropertySchema>;
