/**
 * Guest ID document image (04 FR-7). The uploaded Aadhaar/PAN/passport scan is
 * served inline so it shows in the guest's history. PII-sensitive: gated on
 * `guest:view-pii` (same bar as the reveal sheet), the guest resolved within the
 * caller's org, and the bytes come from encrypted object storage. `?side=back`
 * serves the reverse image (e.g. Aadhaar back). The content type is sniffed from
 * the first bytes since the row stores only the object key, not the media type.
 */
import { getCurrentSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { resolveStorageAdapter } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sniffContentType(bytes: Buffer): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return "application/octet-stream";
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await getCurrentSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const user = session.claims;
  if (!hasPermission(user, "guest:view-pii")) return new Response("Forbidden", { status: 403 });

  const { id } = await ctx.params;
  const side = new URL(req.url).searchParams.get("side") === "back" ? "back" : "front";

  const row = await db.unscoped().guestId.findFirst({
    where: { id, guest: { orgId: user.orgId, deletedAt: null } },
    select: { scanObjectKey: true, backObjectKey: true },
  });
  const key = side === "back" ? row?.backObjectKey : row?.scanObjectKey;
  if (!key) return new Response("Not found", { status: 404 });

  const bytes = await resolveStorageAdapter().get(key);
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": sniffContentType(bytes),
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
    },
  });
}
