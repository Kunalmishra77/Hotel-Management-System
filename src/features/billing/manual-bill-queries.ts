/**
 * Read side of manual bills (specs/06 FR-MB-1): load one for correction. The lines
 * come from the invoice's frozen snapshot (what the customer was given), as
 * pre-tax rates — re-entered exclusive, they reproduce the same amounts.
 */
import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import type { SessionClaims } from "@/lib/auth/claims";

export type ManualBillDraft = {
  invoiceId: string;
  propertyId: string;
  number: string;
  revision: number;
  billDate: string;
  customerName: string;
  customerGstin: string | null;
  customerAddress: string | null;
  customerState: string | null;
  customerPhone: string | null;
  guestName: string | null;
  lines: { description: string; hsnSac: string; quantity: number; ratePaise: number; gstBps: number; inclusive: boolean }[];
};

export async function getManualBill(user: SessionClaims, invoiceId: string): Promise<ManualBillDraft | null> {
  const inv = await db.scoped(user).invoice.findFirst({
    where: { id: invoiceId, type: "TAX_INVOICE", supersededById: null, folio: { kind: "MANUAL" } },
    select: {
      id: true, propertyId: true, number: true, revision: true, issuedAt: true,
      customerName: true, customerGstin: true, customerAddress: true, customerState: true, customerPhone: true, guestName: true,
      lines: { orderBy: { sortOrder: "asc" }, select: { description: true, hsnSac: true, quantity: true, unitPaise: true, amountPaise: true, taxRateBps: true } },
    },
  });
  if (!inv) return null;
  authorize(user, "folio:view", inv.propertyId);
  return {
    invoiceId: inv.id, propertyId: inv.propertyId, number: inv.number, revision: inv.revision,
    billDate: inv.issuedAt.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
    customerName: inv.customerName, customerGstin: inv.customerGstin, customerAddress: inv.customerAddress,
    customerState: inv.customerState, customerPhone: inv.customerPhone, guestName: inv.guestName,
    lines: inv.lines
      .filter((l) => l.description !== "Round off")
      .map((l) => ({
        description: l.description, hsnSac: l.hsnSac ?? "", quantity: l.quantity,
        // The exact pre-tax per-unit value; a line whose amount isn't a whole multiple keeps its total as qty 1.
        ...(Number(l.amountPaise) === l.unitPaise * l.quantity
          ? { ratePaise: l.unitPaise }
          : { ratePaise: Number(l.amountPaise), quantity: 1 }),
        gstBps: l.taxRateBps, inclusive: false,
      })),
  };
}
