/**
 * Reservation-board view filter (Phase 5) — pure. A `?view=` query param focuses
 * the board to one segment; anything unknown falls back to "all" (never an error).
 */
export const BOARD_VIEWS = ["all", "arrivals", "in-house", "departures"] as const;
export type BoardView = (typeof BOARD_VIEWS)[number];

export function parseBoardView(v: unknown): BoardView {
  return typeof v === "string" && (BOARD_VIEWS as readonly string[]).includes(v) ? (v as BoardView) : "all";
}

export const BOARD_VIEW_LABEL: Record<Exclude<BoardView, "all">, string> = {
  arrivals: "Arrivals today",
  "in-house": "In-house",
  departures: "Departures today",
};
