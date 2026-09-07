/**
 * GST invoice PDF download (06 FR-16). Access-controlled: the invoice is resolved
 * through the property-scoped client, so a caller only reaches invoices for a
 * property they can access, and `folio:view` is required. The PDF is decrypted
 * from storage on the fly and served inline (view + save).
 */
import { getCurrentSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { resolveStorageAdapter } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await getCurrentSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const user = session.claims;
  if (!hasPermission(user, "folio:view")) return new Response("Forbidden", { status: 403 });

  const { id } = await ctx.params;
  const invoice = await db.scoped(user).invoice.findFirst({
    where: { id },
    select: { id: true, number: true, pdfObjectKey: true },
  });
  if (!invoice || !invoice.pdfObjectKey) return new Response("Not found", { status: 404 });

  const bytes = await resolveStorageAdapter().get(invoice.pdfObjectKey);
  const safeName = invoice.number.replace(/[^\w.-]/g, "_");
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="invoice-${safeName}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
