/**
 * Generic offline mutation queue (17 T-3/4/5). Modules enqueue a serializable
 * payload under a `kind`; on reconnect `flush` drains the queue IN ORDER, handing
 * each item to that kind's resolver. The resolver classifies the outcome:
 *
 *   "applied"  — server accepted it → drop from queue.
 *   "conflict" — permanently rejected (stale write, illegal transition, gone,
 *                unauthorized) → drop + surface. Retrying can never succeed, so
 *                keeping it would wedge the queue (FR-8).
 *   "retry"    — transient (offline again, 5xx) → keep, try next reconnect.
 *
 * A per-item attempt cap prevents an un-resolvable "retry" from looping forever;
 * on the cap it is dropped + counted as a conflict so the user is told.
 */
import { idbAdd, idbAll, idbDelete, idbPut, isOfflineStorageAvailable, type StoredMutation } from "./db";

export type FlushOutcome = "applied" | "conflict" | "retry";
export type Resolver = (payload: unknown) => Promise<FlushOutcome>;
export type FlushResult = { applied: number; conflicts: number; retried: number };

const MAX_ATTEMPTS = 24;

export { isOfflineStorageAvailable };

/** Queue a mutation for later delivery. */
export async function enqueue(kind: string, payload: unknown): Promise<void> {
  await idbAdd({ kind, payload, createdAt: Date.now(), attempts: 0 });
}

/** Count of pending mutations, optionally filtered to one kind. */
export async function pending(kind?: string): Promise<StoredMutation[]> {
  const all = await idbAll();
  return kind ? all.filter((m) => m.kind === kind) : all;
}

/**
 * Drain the queue in FIFO order. Each item goes to `resolvers[kind]`; an item
 * whose kind has no resolver is left untouched (a different part of the app owns
 * it). Returns tallies for surfacing to the user.
 */
export async function flush(resolvers: Record<string, Resolver>): Promise<FlushResult> {
  const result: FlushResult = { applied: 0, conflicts: 0, retried: 0 };
  if (!isOfflineStorageAvailable()) return result;

  for (const m of await idbAll()) {
    const resolver = resolvers[m.kind];
    if (!resolver || m.id === undefined) continue;

    let outcome: FlushOutcome;
    try {
      outcome = await resolver(m.payload);
    } catch {
      outcome = "retry"; // network/unknown → keep for next reconnect
    }

    if (outcome === "applied") {
      await idbDelete(m.id);
      result.applied += 1;
    } else if (outcome === "conflict") {
      await idbDelete(m.id);
      result.conflicts += 1;
    } else {
      const attempts = m.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await idbDelete(m.id);
        result.conflicts += 1; // gave up — surface it rather than loop forever
      } else {
        await idbPut({ ...m, attempts });
        result.retried += 1;
      }
    }
  }

  return result;
}
