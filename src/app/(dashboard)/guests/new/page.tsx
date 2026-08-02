import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { NewGuestForm } from "@/features/guests/components/new-guest-form";

export const metadata: Metadata = { title: "New guest" };

/** 04 T-20 — create a guest (FR-1/5, AC-1/3). */
export default async function NewGuestPage() {
  await requirePermission("guest:create");
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">New guest</h1>
      <NewGuestForm />
    </div>
  );
}
