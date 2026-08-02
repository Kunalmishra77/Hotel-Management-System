/**
 * 15 — export download (FR-4/6, AC-10). Access-controlled: only the user who
 * created the export (or an admin with export:data) may fetch it; the object is
 * decrypted from storage on the fly and never listed publicly. Every export was
 * already audited at creation.
 */
import { getCurrentSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { resolveStorageAdapter } from "@/lib/storage";
import { CONTENT_TYPE, type ExportFormat } from "@/features/search/export-format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await getCurrentSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const user = session.claims;
  const { id } = await ctx.params;

  const job = await db.unscoped().exportJob.findFirst({
    where: { id },
    select: { id: true, userId: true, format: true, objectKey: true, status: true },
  });
  if (!job || job.status !== "DONE" || !job.objectKey) return new Response("Not found", { status: 404 });

  // Own export, or an admin/accounts with export:data (never another user's PII export by default).
  const isOwner = job.userId === user.userId;
  if (!isOwner && !hasPermission(user, "export:data")) return new Response("Forbidden", { status: 403 });

  const bytes = await resolveStorageAdapter().get(job.objectKey);
  const format = job.format as ExportFormat;
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": CONTENT_TYPE[format] ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="export-${job.id}.${format}"`,
      "Cache-Control": "no-store",
    },
  });
}
