import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guard";
import { getRun } from "@/features/payroll/queries";
import { PayrollRunScreen } from "@/features/payroll/components/payroll-run-screen";

export const metadata: Metadata = { title: "Payroll run" };

/** 21 T-18/T-19 — run detail: line editor + finalize + payslips (AC-6/7/8). */
export default async function PayrollRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const user = await requirePermission("payroll:run");
  const run = await getRun(user, runId);
  if (!run) notFound();
  return <PayrollRunScreen run={run} />;
}
