import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Choose a new password" };

/**
 * The minimum length is org config (FR-1), not a constant, so the form shows
 * the real requirement rather than a guess the server may then reject.
 */
async function passwordMinLength(): Promise<number> {
  // Unscoped by necessity: this runs BEFORE authentication, so there is no
  // session to scope by. SecuritySettings is org-level configuration, not
  // property-scoped operational data, and only a length integer is read.
  const settings = await db.unscoped().securitySettings.findFirst({
    select: { passwordMinLength: true },
  });
  return settings?.passwordMinLength ?? 10;
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Link not valid</CardTitle>
          <CardDescription>
            This reset link is incomplete. Request a new one to continue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild block>
            <Link href="/forgot-password">Request a new link</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return <ResetPasswordForm token={token} minLength={await passwordMinLength()} />;
}
