/**
 * Edge-safe Auth.js configuration.
 *
 * Split from the full config on purpose: `middleware.ts` runs on the Edge
 * runtime, where Prisma cannot run. This half carries no provider and touches
 * no database — it only lets middleware answer "is a session cookie present?"
 * so it can redirect (T-20).
 *
 * That check is NOT authorization. Every server action and route handler
 * re-resolves the session against the database and re-checks `revokedAt`
 * (security.md), which is what makes force-logout and permission changes
 * immediate. Middleware is a UX redirect, nothing more.
 */
import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  pages: {
    signIn: "/sign-in",
    error: "/sign-in",
  },
  session: {
    // The JWT is only a carrier for the opaque session token; authority always
    // comes from the Session row.
    strategy: "jwt",
  },
  trustHost: true,
  providers: [], // added in auth.ts — a credentials provider needs Node APIs
  callbacks: {
    /**
     * Move the opaque session token onto the JWT. No claims are stored here:
     * a token that carried permissions would go stale the moment a role
     * changed, which FR-12 forbids.
     */
    jwt({ token, user }) {
      if (user && "sessionToken" in user && typeof user.sessionToken === "string") {
        token.sessionToken = user.sessionToken;
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.sessionToken === "string") {
        session.sessionToken = token.sessionToken;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
