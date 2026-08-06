import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * App-Router 404. Its presence (alongside global-error.tsx) is also what keeps
 * `next build` from prerendering the legacy pages-router error page, which pulls
 * in `<Html>` and fails the static export.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="font-display text-6xl font-bold text-primary">404</p>
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist or has moved.
      </p>
      <Button asChild>
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
