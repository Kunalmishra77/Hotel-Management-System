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

// MoM: reception logs salary updates — only the salary field (not full staff edit).
export const updateStaffSalarySchema = z.object({
  staffId: z.string().min(1),
  monthlySalaryPaise: z.number().int().positive(),
});

// MoM line 32 — field-staff location tracking.
export const fieldTrackingSchema = z.object({ staffId: z.string().min(1) });

export const fieldPingSchema = z.object({
  token: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().nonnegative().optional(),
});
export type FieldPingInput = z.infer<typeof fieldPingSchema>;
