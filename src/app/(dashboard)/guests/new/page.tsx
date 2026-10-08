import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { NewGuestForm } from "@/features/guests/components/new-guest-form";
import { guestSuggestions } from "@/features/guests/queries";

export const metadata: Metadata = { title: "New guest" };

/** 04 T-20 — create a guest (FR-1/5, AC-1/3). */
export default async function NewGuestPage() {
  const user = await requirePermission("guest:create");
  const suggestions = await guestSuggestions(user);
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">New guest</h1>
      <NewGuestForm suggestions={suggestions} />
    </div>
  );
}
