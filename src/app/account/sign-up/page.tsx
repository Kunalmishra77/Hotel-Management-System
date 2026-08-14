import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { resolveGuestSession } from "@/lib/guest-auth";
import { GuestSignUpForm } from "@/features/guest-account/components/guest-sign-up-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create account · Woodpecker" };

export default async function GuestSignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  if (await resolveGuestSession()) redirect(next && next.startsWith("/") ? next : "/account");

  return (
    <main className="mx-auto flex w-full max-w-md flex-col justify-center px-5 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
          <CardDescription>Or just use your phone number on the sign-in page — no password needed.</CardDescription>
        </CardHeader>
        <CardContent>
          <GuestSignUpForm next={next} />
        </CardContent>
      </Card>
    </main>
  );
}
