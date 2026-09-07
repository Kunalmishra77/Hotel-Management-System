/**
 * Payment receipt PDF (06). Access-controlled: the payment is resolved through
 * the property-scoped client, and `folio:view` is required. The receipt is
 * rendered on the fly (no stored artefact) and served inline.
 */
import { getCurrentSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { folioBalance } from "@/features/billing/domain/balance";
import { renderReceiptPdf } from "@/features/billing/receipt-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await getCurrentSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const user = session.claims;
  if (!hasPermission(user, "folio:view")) return new Response("Forbidden", { status: 403 });

  const { id } = await ctx.params;
  const payment = await db.scoped(user).payment.findFirst({
    where: { id },
    select: {
      id: true, propertyId: true, mode: true, amountPaise: true, reference: true, receivedAt: true, isRefund: true,
      folio: {
        select: {
          reservation: { select: { code: true, guest: { select: { fullName: true } } } },
          lines: { select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } },
          payments: { select: { amountPaise: true, isRefund: true } },
        },
      },
    },
  });
  if (!payment) return new Response("Not found", { status: 404 });

  const property = await db.unscoped().property.findFirst({
    where: { id: payment.propertyId },
    select: { name: true, addressLine1: true, city: true, state: true, pincode: true, gstin: true },
  });
  if (!property) return new Response("Not found", { status: 404 });

  const balancePaise = Number(folioBalance(payment.folio.lines, payment.folio.payments));
  const bytes = await renderReceiptPdf({
    receiptNo: payment.reference ?? `RCPT-${payment.id.slice(-8).toUpperCase()}`,
    receivedAt: payment.receivedAt,
    property,
    guestName: payment.folio.reservation?.guest?.fullName ?? "Guest",
    bookingCode: payment.folio.reservation?.code ?? null,
    amountPaise: Number(payment.amountPaise),
    mode: payment.mode,
    reference: payment.reference,
    isRefund: payment.isRefund,
    balancePaise,
  });

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="receipt-${payment.id.slice(-8)}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
