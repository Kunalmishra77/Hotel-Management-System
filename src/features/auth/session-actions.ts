"use server";

/**
 * Session-management actions (multi-device handling). Every write is scoped to
 * the caller's own userId, so one user can never revoke another's session.
 */
import { revalidatePath } from "next/cache";
import { getCurrentSession } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { authDb, withUserContext } from "./internal";

export async function revokeSessionAction(sessionId: string): Promise<{ ok: boolean }> {
  const session = await getCurrentSession();
  if (!session) return { ok: false };
  // The current session is ended via Sign out, not here.
  if (!sessionId || sessionId === session.sessionId) return { ok: false };

  const { claims } = session;
  await withUserContext(claims.orgId, claims.userId, () =>
    authDb.$transaction(async (tx) => {
      await tx.session.updateMany({
        where: { id: sessionId, userId: claims.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await writeAudit(tx, {
        action: "auth:session-revoke",
        entityType: "Session",
        entityId: sessionId,
      });
    }),
  );
  revalidatePath("/settings/security");
  return { ok: true };
}

export async function revokeOtherSessionsAction(): Promise<{ ok: boolean; count: number }> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, count: 0 };

  const { claims, sessionId } = session;
  let count = 0;
  await withUserContext(claims.orgId, claims.userId, () =>
    authDb.$transaction(async (tx) => {
      const revoked = await tx.session.updateMany({
        where: { userId: claims.userId, revokedAt: null, NOT: { id: sessionId } },
        data: { revokedAt: new Date() },
      });
      count = revoked.count;
      await writeAudit(tx, {
        action: "auth:session-revoke-others",
        entityType: "User",
        entityId: claims.userId,
        after: { count },
      });
    }),
  );
  revalidatePath("/settings/security");
  return { ok: true, count };
}
