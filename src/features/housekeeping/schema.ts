/** Housekeeping input schemas (zod) — 10. */
import { z } from "zod";

export const updateTaskStatusSchema = z.object({
  taskId: z.string().min(1),
  status: z.enum(["PENDING", "IN_PROGRESS", "DONE"]),
  clientUpdatedAt: z.coerce.date().optional(),
});
export type UpdateTaskStatusInput = z.infer<typeof updateTaskStatusSchema>;

export const recordDetailsSchema = z.object({
  taskId: z.string().min(1),
  linenChanged: z.boolean().optional(),
  towelChanged: z.boolean().optional(),
  complaint: z.string().max(500).optional(),
  maintenanceCategory: z.enum(["AC", "ELECTRICAL", "PLUMBING", "FURNITURE", "PAINTING", "PEST_CONTROL", "OTHER"]).optional(),
});

export const syncSchema = z.object({
  updates: z.array(z.object({
    taskId: z.string().min(1),
    status: z.enum(["PENDING", "IN_PROGRESS", "DONE"]),
    clientUpdatedAt: z.coerce.date(),
  })).min(1),
});
export type SyncInput = z.infer<typeof syncSchema>;
