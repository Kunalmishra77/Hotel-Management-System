/** Maintenance input schemas (zod) — 11. */
import { z } from "zod";

const category = z.enum(["AC", "ELECTRICAL", "PLUMBING", "FURNITURE", "PAINTING", "PEST_CONTROL", "OTHER"]);

export const createJobSchema = z.object({
  propertyId: z.string().min(1),
  roomId: z.string().min(1).optional(),
  category,
  description: z.string().min(1).max(500),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  isPreventive: z.boolean().default(false),
  scheduledFor: z.coerce.date().optional(),
  recurrence: z.string().max(40).optional(),
});
export type CreateJobInput = z.infer<typeof createJobSchema>;

export const startJobSchema = z.object({ jobId: z.string().min(1) });
export const closeJobSchema = z.object({
  jobId: z.string().min(1),
  costPaise: z.number().int().min(0).optional(),
  vendor: z.string().trim().max(120).optional(),
});
export const blockRoomForJobSchema = z.object({
  jobId: z.string().min(1),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  force: z.boolean().default(false),
});
