import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireGuest, getGuestSummary } from "@/features/guest-account/queries";
import { ProfileForm } from "@/features/guest-account/components/profile-form";
import { PLACEHOLDER_GUEST_NAME } from "@/features/guest-account/internal";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Welcome · Woodpecker" };

/** Post-signup name capture (phone path). A brand-new phone-only account has no
 *  real name yet; we ask for it here, then continue to wherever they were headed. */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const principal = await requireGuest("/account/welcome");
  const [{ next }, summary] = await Promise.all([searchParams, getGuestSummary(principal)]);
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/account";
  const prefill = summary.fullName === PLACEHOLDER_GUEST_NAME ? "" : summary.fullName;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col justify-center px-5 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Welcome to Woodpecker</CardTitle>
          <CardDescription>One quick thing — what should we call you?</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm
            next={safeNext}
            defaultName={prefill}
            currentEmailMasked={summary.emailMasked}
            submitLabel="Continue"
          />
        </CardContent>
      </Card>
    </main>
  );
}
