/**
 * Room inspection (architecture v2 · Phase 5) — zod boundary. After a room is
 * cleaned it is inspected: PASS → ready, FAIL → re-clean with defect notes.
 */
import { z } from "zod";

export const INSPECTION_RESULTS = ["PASS", "FAIL"] as const;

export const recordInspectionSchema = z.object({
  roomId: z.string().min(1),
  status: z.enum(INSPECTION_RESULTS),
  defectNotes: z.string().trim().max(500).optional(),
});
export type RecordInspectionInput = z.input<typeof recordInspectionSchema>;
