/** Staff input schemas (zod) — 09. */
import { z } from "zod";

export const createStaffSchema = z.object({
  propertyId: z.string().min(1),
  name: z.string().min(1).max(120),
  mobile: z.string().min(6).max(20),
  department: z.string().min(1).max(60),
  monthlySalaryPaise: z.number().int().positive(),
  joinedOn: z.coerce.date(),
  address: z.string().max(300).optional(),
  aadhaar: z.string().max(20).optional(),
  pan: z.string().max(20).optional(),
  bankAccount: z.string().max(40).optional(),
  bankIfsc: z.string().max(20).optional(),
});
export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const updateStaffSchema = z.object({
  staffId: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  mobile: z.string().min(6).max(20).optional(),
  department: z.string().min(1).max(60).optional(),
  monthlySalaryPaise: z.number().int().positive().optional(),
  address: z.string().max(300).optional(),
  aadhaar: z.string().max(20).optional(),
  pan: z.string().max(20).optional(),
  bankAccount: z.string().max(40).optional(),
  bankIfsc: z.string().max(20).optional(),
});

export const recordAttendanceSchema = z.object({
  staffId: z.string().min(1),
  day: z.coerce.date(),
  checkInAt: z.coerce.date().optional(),
  checkOutAt: z.coerce.date().optional(),
  isLeave: z.boolean().default(false),
  leaveType: z.enum(["NONE", "CASUAL", "SICK", "PAID", "UNPAID"]).default("NONE"),
  overtimeMinutes: z.number().int().min(0).default(0),
});
export type RecordAttendanceInput = z.infer<typeof recordAttendanceSchema>;

export const deactivateStaffSchema = z.object({
  staffId: z.string().min(1),
  leftOn: z.coerce.date().optional(),
});
