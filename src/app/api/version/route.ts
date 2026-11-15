/**
 * The running build's id, for open tabs to notice a new deployment (client,
 * 15 Nov 2026: after each deploy, tabs left open called server actions the new
 * build no longer has — buttons silently did nothing and the app "felt slow").
 * Not in middleware's public list, so only signed-in staff can read it; it is
 * a hash, never the raw build id or any configuration.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cached: string | null = null;
function buildTag(): string {
  if (cached) return cached;
  let raw = "dev";
  try {
    raw = readFileSync(join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
  } catch {
    // `next dev` has no BUILD_ID file — a constant tag means "never stale".
  }
  cached = createHash("sha256").update(raw).digest("hex").slice(0, 12);
  return cached;
}

export async function GET(): Promise<Response> {
  return Response.json({ build: buildTag() }, { headers: { "Cache-Control": "no-store" } });
}
