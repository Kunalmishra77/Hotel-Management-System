// See as-user-hook.cjs. Everything from the real module, except who the user is.
import type { SessionClaims } from "../../src/lib/auth/claims";
export * from "../../src/lib/auth/claims";
export * from "../../src/lib/auth/password";

function claims(): SessionClaims {
  const c = (globalThis as { __SCRIPT_CLAIMS?: SessionClaims }).__SCRIPT_CLAIMS;
  if (!c) throw new Error("script claims not set");
  return c;
}
export async function requireUser(): Promise<SessionClaims> { return claims(); }
export async function getCurrentSession(): Promise<{ claims: SessionClaims } | null> { return { claims: claims() }; }
export async function requireSession(): Promise<{ claims: SessionClaims }> { return { claims: claims() }; }
