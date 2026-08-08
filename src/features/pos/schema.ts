/**
 * POS input schemas (zod) — 19. Every boundary validated (FR-16, AC-4). Amounts
 * are integer paise; a line's quantity must be positive and its unit non-negative
 * (a zero/negative line is rejected before anything persists).
 */
import { z } from "zod";

export const createOrderSchema = z.object({
  outletId: z.string().min(1),
  /** In-house reservation to settle to later; omit for a walk-in / direct sale. */
  reservationId: z.string().min(1).optional(),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const addItemSchema = z
  .object({
    orderId: z.string().min(1),
    /** When given, name/unit/hsn/gst are resolved from the menu (config-driven). */
    menuItemId: z.string().min(1).optional(),
    /** Required for a custom (off-menu) line. */
    name: z.string().min(1).max(120).optional(),
    quantity: z.number().int().positive(), // FR-16: quantity ≤ 0 rejected
    /** Required for a custom line; ignored when a menuItemId is given. */
    unitPaise: z.number().int().min(0).optional(), // FR-16: negative price rejected
    hsnSac: z.string().max(12).optional(),
    gstBps: z.number().int().min(0).max(5000).optional(),
  })
  .refine((v) => v.menuItemId != null || (v.name != null && v.unitPaise != null), {
    message: "Provide a menuItemId, or a name and unitPaise for a custom line.",
  });
export type AddItemInput = z.infer<typeof addItemSchema>;

export const removeItemSchema = z.object({
  orderId: z.string().min(1),
  itemId: z.string().min(1),
});

export const applyDiscountSchema = z.object({
  orderId: z.string().min(1),
  amountPaise: z.number().int().min(0),
  reason: z.string().min(1).max(300),
});

export const sendToKitchenSchema = z.object({ orderId: z.string().min(1) });

export const settleToFolioSchema = z.object({ orderId: z.string().min(1) });

export const settleDirectSchema = z.object({
  orderId: z.string().min(1),
  customerName: z.string().min(1).max(200),
  customerGstin: z.string().max(20).optional(),
  tender: z.object({
    mode: z.enum(["CASH", "CREDIT_CARD", "DEBIT_CARD", "UPI"]),
    /** Optional: defaults to the order's derived total when omitted. */
    amountPaise: z.number().int().positive().optional(),
  }),
});

export const voidOrderSchema = z.object({
  orderId: z.string().min(1),
  reason: z.string().min(1).max(300),
});

// 19 addendum — kitchen lifecycle + guest QR ordering.
export const ticketActionSchema = z.object({ ticketId: z.string().min(1) });

export const submitGuestOrderSchema = z.object({
  token: z.string().min(1),
  lines: z
    .array(z.object({ menuItemId: z.string().min(1), quantity: z.number().int().positive() }))
    .min(1, "Add at least one item."),
  note: z.string().max(300).optional(),
});
export type SubmitGuestOrderInput = z.infer<typeof submitGuestOrderSchema>;

export const acceptGuestOrderSchema = z.object({ orderId: z.string().min(1) });
export const rejectGuestOrderSchema = z.object({
  orderId: z.string().min(1),
  reason: z.string().min(1).max(300),
});
