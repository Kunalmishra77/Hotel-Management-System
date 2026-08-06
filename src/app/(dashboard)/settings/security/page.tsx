import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ChangePasswordForm } from "@/features/auth/components/change-password-form";
import { SessionsList } from "@/features/auth/components/sessions-list";
import { listActiveSessions } from "@/features/auth/session-queries";

export const metadata: Metadata = { title: "Security" };

// Available to every signed-in user — this is personal account security, not the
// admin's `settings:manage` surface.
export default async function SecurityPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in?next=/settings/security");

  const active = await listActiveSessions();

  return (
    <>
      <Breadcrumb
        items={[{ label: "Home", href: "/dashboard" }, { label: "Settings" }, { label: "Security" }]}
        className="mb-3"
      />
      <PageHeader title="Security" description="Manage your password and the devices signed in to your account." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>Changing your password signs out your other devices.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active sessions</CardTitle>
            <CardDescription>Devices currently signed in to your account.</CardDescription>
          </CardHeader>
          <CardContent>
            {active ? <SessionsList sessions={active.sessions} currentId={active.currentId} /> : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
