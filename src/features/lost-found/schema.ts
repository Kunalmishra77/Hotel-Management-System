import { z } from "zod";

export const logLostItemSchema = z.object({
  description: z.string().trim().min(2, "Describe the item.").max(200),
  roomNumber: z.string().trim().max(20).optional(),
  foundOn: z.coerce.date(),
  notes: z.string().trim().max(500).optional(),
});
export type LogLostItemInput = z.input<typeof logLostItemSchema>;

export const resolveLostItemSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["CLAIMED", "DISPOSED"]),
  claimantName: z.string().trim().max(120).optional(),
});
export type ResolveLostItemInput = z.input<typeof resolveLostItemSchema>;
