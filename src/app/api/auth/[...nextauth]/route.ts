/**
 * Auth.js route handler — 00 T-3.
 *
 * Node runtime, not Edge: the credentials provider runs bcrypt and Prisma.
 * (`middleware.ts` uses the edge-safe half of the config instead — see
 * lib/auth/auth.config.ts.)
 */
import { handlers } from "@/lib/auth";

export const runtime = "nodejs";

export const { GET, POST } = handlers;
