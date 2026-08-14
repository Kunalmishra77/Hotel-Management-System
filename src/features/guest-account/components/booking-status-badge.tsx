/**
 * Guest-facing reservation status badge (Phase 2 T-6). Plain (server-renderable);
 * maps the internal ReservationStatus to guest-friendly wording + a tone.
 */
const META: Record<string, { label: string; className: string }> = {
  ENQUIRY: { label: "Pending payment", className: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  CONFIRMED: { label: "Confirmed", className: "bg-success/10 text-success" },
  IN_HOUSE: { label: "Checked in", className: "bg-primary/10 text-primary" },
  CHECKED_OUT: { label: "Completed", className: "bg-muted text-muted-foreground" },
  CANCELLED: { label: "Cancelled", className: "bg-destructive/10 text-destructive" },
  NO_SHOW: { label: "No-show", className: "bg-destructive/10 text-destructive" },
};

export function BookingStatusBadge({ status }: { status: string }) {
  const meta = META[status] ?? { label: status, className: "bg-muted text-muted-foreground" };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.className}`}>
      {meta.label}
    </span>
  );
}
