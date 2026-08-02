/**
 * Maintenance job lifecycle + preventive recurrence — 11 T-3/T-4 (FR-4/6, AC-5/6).
 * Pure. The state machine is the single authority; a re-open (CLOSED→OPEN) is
 * illegal (AC-5).
 */
export type JobStatus = "OPEN" | "IN_PROGRESS" | "CLOSED";

const ALLOWED: Record<JobStatus, readonly JobStatus[]> = {
  OPEN: ["IN_PROGRESS", "CLOSED"],
  IN_PROGRESS: ["CLOSED"],
  CLOSED: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return ALLOWED[from].includes(to);
}

/**
 * Next due date for a preventive schedule (FR-4). `recurrence` is a simple word
 * (daily/weekly/monthly); anything else defaults to monthly. Computed in UTC
 * calendar terms (schedules are date-only).
 */
export function nextPreventiveDate(from: Date, recurrence: string): Date {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth();
  const d = from.getUTCDate();
  switch (recurrence.toLowerCase()) {
    case "daily": return new Date(Date.UTC(y, m, d + 1));
    case "weekly": return new Date(Date.UTC(y, m, d + 7));
    case "monthly":
    default: return new Date(Date.UTC(y, m + 1, d));
  }
}
