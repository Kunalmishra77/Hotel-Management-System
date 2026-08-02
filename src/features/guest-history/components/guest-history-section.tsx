/**
 * Guest history section — 05 T-9 (FR-3/4, AC-5/6). Rendered on the 04 profile.
 * Presentational + server-safe. Financial figures are already null when the
 * caller lacks `report:view-financial` (the query masks them), so this just shows
 * what it's given — stay counts always, money only when present.
 */
import type { GuestHistoryView } from "../queries";

const rupees = (p: number) => `₹${p.toLocaleString("en-IN")}`;

export function GuestHistorySection({
  history,
  preferredCategoryName,
}: {
  history: GuestHistoryView;
  preferredCategoryName: string | null;
}) {
  return (
    <section className="space-y-3 rounded-md border p-4" data-testid="guest-history">
      <h2 className="text-base font-semibold">History</h2>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <Stat label="Visits" value={String(history.visits)} testid="history-visits" />
        <Stat label="Room-nights" value={String(history.totalRoomNights)} />
        {history.totalRevenuePaise !== null ? (
          <Stat label="Revenue" value={rupees(Math.round(history.totalRevenuePaise / 100))} testid="history-revenue" />
        ) : (
          <Stat label="Revenue" value="—" testid="history-revenue-masked" />
        )}
        {history.outstandingPaise !== null && (
          <Stat label="Outstanding" value={rupees(Math.round(history.outstandingPaise / 100))} />
        )}
        <Stat label="Prefers" value={preferredCategoryName ?? "—"} />
        <Stat label="Last stay" value={history.lastStayAt ? history.lastStayAt.toISOString().slice(0, 10) : "—"} />
      </dl>

      {history.bills.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground">Bills</h3>
          <ul className="divide-y rounded-md border" data-testid="history-bills">
            {history.bills.map((b) => (
              <li key={b.number} className="flex items-center justify-between p-2 text-sm">
                <span className="font-mono">{b.number}{b.type === "CREDIT_NOTE" ? " (credit note)" : ""}</span>
                <span className="text-muted-foreground">{b.totalPaise !== null ? rupees(Math.round(b.totalPaise / 100)) : "—"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {history.feedback.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground">Feedback</h3>
          <ul className="space-y-1 text-sm" data-testid="history-feedback">
            {history.feedback.map((f, i) => (
              <li key={i}>
                {f.rating ? "★".repeat(f.rating) : ""} {f.comment ?? ""}
                {f.sentiment && <span className="text-muted-foreground"> · {f.sentiment}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, testid }: { label: string; value: string; testid?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd data-testid={testid}>{value}</dd>
    </div>
  );
}
