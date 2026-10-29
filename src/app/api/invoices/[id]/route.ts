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
import { ensureInvoicePdf } from "@/features/billing/invoice-pdf-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await getCurrentSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const user = session.claims;
  if (!hasPermission(user, "folio:view")) return new Response("Forbidden", { status: 403 });

  const { id } = await ctx.params;
  const invoice = await db.scoped(user).invoice.findFirst({
    where: { id },
    select: { id: true, number: true, pdfObjectKey: true },
  });
  if (!invoice) return new Response("Not found", { status: 404 });

  // Render lazily on first view for invoices whose PDF was deferred (bulk import).
  // ensureInvoicePdf returns the stored key at once, or renders it (deferred
  // imports; credit notes stored before they were titled "CREDIT NOTE").
  const key = await ensureInvoicePdf(invoice.id);
  if (!key) return new Response("Not found", { status: 404 });

  const bytes = await resolveStorageAdapter().get(key);
  const safeName = invoice.number.replace(/[^\w.-]/g, "_");
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      // ?download=1 → save the file (invoice picker "Download"); otherwise open inline.
      "Content-Disposition": `${new URL(req.url).searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="invoice-${safeName}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
