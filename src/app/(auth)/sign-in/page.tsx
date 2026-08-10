import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import { SignInForm } from "@/features/auth/components/sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string; role?: string }>;
}) {
  const params = await searchParams;

  /**
   * Skip the form for someone who is genuinely signed in.
   *
   * This check lives here rather than in middleware because it needs the REAL
   * session: middleware runs on the Edge and can only see that a cookie exists,
   * and redirecting on that alone loops forever when the DB session has been
   * revoked but the cookie has not expired (see middleware.ts).
   */
  if (await getCurrentSession()) redirect("/dashboard");

  return <SignInForm next={params.next} justReset={params.reset === "1"} role={params.role} />;
}
