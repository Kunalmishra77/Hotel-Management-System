/**
 * (dashboard) route-group layout — 00 T-20 (FR-26, AC-24).
 *
 * This is the REAL auth gate. `middleware.ts` only checks for a cookie on the
 * Edge; here the session is resolved against the database and `revokedAt` is
 * re-checked (security.md), so a revoked-but-unexpired cookie gets no further
 * than this. Every dashboard route inherits it.
 */
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import { listAccessibleProperties } from "@/features/platform/actions";
import { AppShell } from "@/features/platform/components/app-shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in");

  const properties = await listAccessibleProperties();

  return (
    <AppShell claims={session.claims} properties={properties}>
      {children}
    </AppShell>
  );
}
