/**
 * Instant navigation feedback for every dashboard page.
 *
 * The pages are server-rendered and fetch data, so without a loading UI a click
 * appears to "freeze" on the old page until the server responds. This skeleton
 * renders IMMEDIATELY on any navigation (the shell/sidebar stay put), so the app
 * always feels responsive while the real content streams in behind it.
 */
function Bar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />;
}

export default function DashboardLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6" aria-busy="true" aria-label="Loading">
      {/* Header */}
      <div className="space-y-2">
        <Bar className="h-7 w-56" />
        <Bar className="h-4 w-72" />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card p-4 shadow-card">
            <Bar className="h-3 w-20" />
            <Bar className="mt-3 h-7 w-24" />
            <Bar className="mt-2 h-3 w-16" />
          </div>
        ))}
      </div>

      {/* Content block */}
      <div className="rounded-xl border bg-card p-5 shadow-card">
        <Bar className="h-5 w-40" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <Bar className="h-4 w-1/3" />
              <Bar className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
