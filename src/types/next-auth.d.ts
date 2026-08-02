/**
 * Auth.js type augmentation.
 *
 * The session carries ONE thing: the opaque token that identifies the DB-backed
 * `Session` row. Permissions and property scope are deliberately absent — they
 * are resolved per request by `assembleClaims` so a role change takes effect on
 * the next request (FR-12) and a revoked session dies immediately.
 */
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session extends DefaultSession {
    sessionToken?: string;
  }

  interface User {
    /** Set by the credentials provider's `authorize`. */
    sessionToken?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    sessionToken?: string;
  }
}

export {};
