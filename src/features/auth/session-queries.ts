import { getCurrentSession } from "@/lib/auth";
import { authDb } from "./internal";

export type ActiveSessionView = {
  id: string;
  current: boolean;
  ip: string | null;
  device: string | null;
  createdAt: Date;
  expiresAt: Date;
};

/**
 * The signed-in user's live sessions (multi-device handling). Scoped to the
 * caller's own userId — a user can only ever see their own devices.
 */
export async function listActiveSessions(): Promise<{
  currentId: string;
  sessions: ActiveSessionView[];
} | null> {
  const session = await getCurrentSession();
  if (!session) return null;

  const rows = await authDb.session.findMany({
    where: { userId: session.claims.userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, ip: true, device: true, createdAt: true, expiresAt: true },
  });

  return {
    currentId: session.sessionId,
    sessions: rows.map((r) => ({ ...r, current: r.id === session.sessionId })),
  };
}
