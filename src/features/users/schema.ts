import { RoleName } from "@prisma/client";
import { z } from "zod";

const roleAssignment = z.object({
  role: z.nativeEnum(RoleName),
  propertyIds: z.array(z.string().min(1)).default([]),
});

export const createUserSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("Enter a valid email address."),
    name: z.string().trim().min(1, "Name is required.").max(120),
    password: z.string().min(10, "Password must be at least 10 characters."),
    role: z.nativeEnum(RoleName),
    propertyIds: z.array(z.string().min(1)).default([]),
  })
  .refine((v) => v.role === "ADMINISTRATOR" || v.propertyIds.length > 0, {
    message: "Select at least one property for this role.",
    path: ["propertyIds"],
  });

export const updateUserRolesSchema = z
  .object({
    userId: z.string().min(1),
    assignments: z.array(roleAssignment).min(1, "Assign at least one role."),
  })
  .refine((v) => v.assignments.every((a) => a.role === "ADMINISTRATOR" || a.propertyIds.length > 0), {
    message: "Non-admin roles need at least one property.",
    path: ["assignments"],
  });

export const setUserActiveSchema = z.object({
  userId: z.string().min(1),
  isActive: z.boolean(),
});

export const adminResetPasswordSchema = z.object({
  userId: z.string().min(1),
  password: z.string().min(10, "Password must be at least 10 characters."),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
