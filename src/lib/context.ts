/**
 * Per-request context — specs/00-platform/design.md § Core primitives.
 *
 * Carries {orgId, userId, propertyScope, activePropertyId, requestId, ip, device}
 * through the call stack via AsyncLocalStorage so `db`, `writeAudit()` and
 * `emitEvent()` fill the actor fields themselves (FR-15). Callers never thread
 * these by hand — which is what stops an audit row from silently losing its
 * actor because someone forgot an argument.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type PropertyScope =
  /** Administrator: every property in the org (FR-10). */
  | { kind: "ALL_IN_ORG" }
  /** Everyone else: an explicit allow-list of property ids. */
  | { kind: "PROPERTIES"; propertyIds: readonly string[] };

export type RequestContext = {
  orgId: string;
  userId: string;
  propertyScope: PropertyScope;
  activePropertyId: string | null;
  requestId: string;
  ip: string | null;
  device: string | null;
};

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with `ctx` bound for the whole async subtree. */
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** The current context, or undefined outside a request (worker, script, test). */
export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * The current context, or throw. Use where an actor is mandatory — e.g. writing
 * an audit row for a user-initiated mutation.
 */
export function requireContext(): RequestContext {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error(
      "No request context. Server actions must run inside runWithContext(); " +
        "background jobs must use runWithSystemContext().",
    );
  }
  return ctx;
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

export function newRequestId(): string {
  return randomUUID();
}

/**
 * The synthetic actor for background work (outbox dispatch, night audit, backup).
 * Jobs still emit events and write audit rows; they just have no human userId.
 */
export const SYSTEM_USER_ID = "system";

export function runWithSystemContext<T>(orgId: string, fn: () => T): T {
  return runWithContext(
    {
      orgId,
      userId: SYSTEM_USER_ID,
      propertyScope: { kind: "ALL_IN_ORG" },
      activePropertyId: null,
      requestId: newRequestId(),
      ip: null,
      device: "worker",
    },
    fn,
  );
}

/** True when the caller's scope covers `propertyId` (FR-8/9/10). */
export function scopeIncludes(scope: PropertyScope, propertyId: string): boolean {
  if (scope.kind === "ALL_IN_ORG") return true;
  return scope.propertyIds.includes(propertyId);
}
