/**
 * An expense's bill scan (07 FR-3). Access-controlled: resolved through the
 * property-scoped client and needs `expense:create` (whoever records / approves
 * expenses). The scan is read from storage and served inline — never public.
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
  if (!hasPermission(user, "expense:create")) return new Response("Forbidden", { status: 403 });

  const { id } = await ctx.params;
  const expense = await db.scoped(user).expense.findFirst({ where: { id }, select: { billObjectKey: true } });
  if (!expense?.billObjectKey) return new Response("Not found", { status: 404 });

  const bytes = await resolveStorageAdapter().get(expense.billObjectKey);
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "Content-Type": "image/jpeg", "Content-Disposition": "inline", "Cache-Control": "no-store" },
  });
}
