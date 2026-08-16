import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireGuest, getGuestSummary } from "@/features/guest-account/queries";
import { ProfileForm } from "@/features/guest-account/components/profile-form";
import { PLACEHOLDER_GUEST_NAME } from "@/features/guest-account/internal";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit profile · Woodpecker" };

/** Let a signed-in guest set/correct their name and email at any time. */
export default async function ProfilePage() {
  const principal = await requireGuest("/account/profile");
  const summary = await getGuestSummary(principal);
  const prefill = summary.fullName === PLACEHOLDER_GUEST_NAME ? "" : summary.fullName;

  return (
    <main className="mx-auto w-full max-w-md px-5 py-10">
      <Link
        href="/account"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" /> Back to account
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>Edit profile</CardTitle>
          <CardDescription>Update the name and email on your account.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm
            next="/account"
            defaultName={prefill}
            currentEmailMasked={summary.emailMasked}
            submitLabel="Save changes"
          />
        </CardContent>
      </Card>
    </main>
  );
}
