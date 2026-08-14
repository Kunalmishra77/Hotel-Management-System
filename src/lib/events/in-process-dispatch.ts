/**
 * In-process outbox tick (Phase 3). The event backbone historically ran only in
 * the standalone worker (`scripts/worker.ts`); a single-process deploy (Coolify
 * running `next start` with no worker) therefore delivered NO event — comms,
 * guest-history, notifications all silent.
 *
 * Rather than an Edge-incompatible instrumentation hook, we dispatch opportunistically
 * from Node server actions (the notification bell polls one every ~20s while staff
 * are active). `tickOutboxOnce` registers the consumers once and runs a single
 * dispatch pass, guarded so overlapping calls (many active users) never stack.
 * Idempotent + best-effort: a failure is logged, never thrown to the caller.
 *
 * Opt out with `IN_PROCESS_OUTBOX=false` when a dedicated worker is deployed.
 */
import { registerAllConsumers } from "@/features/register-consumers";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { dispatchOutbox } from "./dispatch";

let registered = false;
let running = false;

export async function tickOutboxOnce(): Promise<void> {
  if (process.env.IN_PROCESS_OUTBOX === "false") return;
  if (running) return; // never overlap two dispatch passes in a process
  running = true;
  try {
    if (!registered) {
      registerAllConsumers();
      registered = true;
    }
    await dispatchOutbox(db.unscoped());
  } catch (e) {
    logger.error("in-process-outbox.tick_failed", { error: e instanceof Error ? e.message : String(e) });
  } finally {
    running = false;
  }
}
