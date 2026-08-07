/**
 * 18 AI · Document-AI passport extraction for FRRO / Form C (03 T7).
 *
 * ai-features.md: grounding over generation; the LLM NEVER mutates data — it
 * proposes fields that reception verifies + edits before the Form C is saved.
 * The default `mock` provider returns an empty shape (no OCR in the sandbox), so
 * the wizard falls back to manual entry. A live vision adapter fills these in.
 */
import { z } from "zod";
import { completeStructured } from "@/lib/ai";

export const passportFieldsSchema = z
  .object({
    fullName: z.string(),
    nationality: z.string(),
    passportNumber: z.string(),
    passportPlaceOfIssue: z.string(),
    passportIssueDate: z.string(), // ISO yyyy-mm-dd
    passportExpiryDate: z.string(),
    dateOfBirth: z.string(),
  })
  .partial();
export type PassportFields = z.infer<typeof passportFieldsSchema>;

/**
 * Extract passport fields from a scan's text/context. Returns only what the
 * provider could read (empty in the sandbox). Never invents data.
 */
export async function extractPassportFields(scanContext: string): Promise<PassportFields> {
  const { data } = await completeStructured({
    system:
      "You extract fields from a passport document. Return ONLY fields you can read " +
      "from the provided content; leave the rest empty. Never invent or guess a value.",
    messages: [{ role: "user", content: scanContext }],
    feature: "passport-extract",
    schema: passportFieldsSchema,
  });
  return data;
}
