import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The 403 boundary — 00 FR-13 / AC-11.
 *
 * Rendered when `requirePermission()` calls `forbidden()`. Deliberately says
 * only that permission is missing: it names no permission and lists no other
 * route, so a denial cannot be used to map what exists.
 */
export default function Forbidden() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>Not permitted</CardTitle>
            <CardDescription>
              Your role doesn&apos;t have access to this section. If you think that&apos;s wrong,
              ask an administrator.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild block variant="outline">
              <Link href="/dashboard">Back to dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
