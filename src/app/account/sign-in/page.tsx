import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { resolveGuestSession } from "@/lib/guest-auth";
import { GuestAuthForm } from "@/features/guest-account/components/guest-auth-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in · Woodpecker" };

export default async function GuestSignInPage({
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
          <CardTitle>Sign in to your account</CardTitle>
          <CardDescription>Manage your bookings and speed up checkout. Phone or email — your choice.</CardDescription>
        </CardHeader>
        <CardContent>
          <GuestAuthForm next={next} />
        </CardContent>
      </Card>
    </main>
  );
}
