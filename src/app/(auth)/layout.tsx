/**
 * Auth route-group shell — specs/00-platform/design.md § UI wireframes.
 * Single-column, thumb-reachable, no navigation (nothing to navigate to yet).
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-primary">Woodpecker PMS</h1>
          <p className="mt-1 text-sm text-muted-foreground">Apartments &amp; Suites</p>
        </div>
        {children}
      </div>
    </main>
  );
}
