/**
 * Liveness + readiness — observability.md ("used by CD smoke test + load
 * balancer"), deployment-and-infra.md § CI/CD.
 *
 * Unauthenticated by design (it is in middleware's public list), so it returns
 * no version, build or configuration detail an attacker could use.
 */
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const startedAt = Date.now();
  let database: "up" | "down" = "down";

  try {
    // Unscoped by necessity: a liveness probe has no user and no
    // property scope. It reads nothing — `SELECT 1` only proves the
    // connection is alive.
    await db.unscoped().$queryRaw`SELECT 1`;
    database = "up";
  } catch {
    database = "down";
  }

  const healthy = database === "up";
  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      database,
      latencyMs: Date.now() - startedAt,
    },
    { status: healthy ? 200 : 503 },
  );
}
