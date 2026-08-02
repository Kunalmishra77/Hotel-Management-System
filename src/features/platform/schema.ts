/**
 * Zod schemas for the platform feature's server actions.
 * api-conventions.md: every input boundary is validated.
 */
import { z } from "zod";

export const switchPropertySchema = z.object({
  propertyId: z.string().min(1, "A property is required."),
});

export type SwitchPropertyInput = z.infer<typeof switchPropertySchema>;
