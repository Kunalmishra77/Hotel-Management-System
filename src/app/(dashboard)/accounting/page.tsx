import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { reconciliation } from "@/features/accounting/queries";
import { AccountingView } from "@/features/accounting/components/accounting-view";

export const metadata: Metadata = { title: "Accounting" };

/**
 * 22 T-10 — accounting reconciliation + retry + provider/mode config.
 *
 * `integration:manage` is org-wide, so the guard is called with a null property
 * (there is no per-property accounting config). The server re-checks on every
 * action; the page render is a read gated the same way.
 */
export default async function AccountingPage() {
  const user = await requirePermission("integration:manage", null);
  const recon = await reconciliation(user);

  return (
    <AccountingView providers={recon.providers} failed={recon.failed} recent={recon.recent} />
  );
}
