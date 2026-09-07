/**
 * 18 AI · Document-AI extraction of a GUEST record for historical data entry.
 *
 * ai-features.md: grounding over generation; the LLM NEVER writes data — it
 * proposes fields that staff verify + edit before the guest is created. The
 * default `mock` provider returns an empty shape (no extraction in the sandbox),
 * so data entry falls back to manual typing; a configured provider fills what it
 * can read from the record text. Never invents a value.
 */
import { z } from "zod";
import { completeStructured } from "@/lib/ai";

export const guestFieldsSchema = z
  .object({
    fullName: z.string(),
    mobile: z.string(),
    email: z.string(),
    dob: z.string(), // ISO yyyy-mm-dd
    gender: z.string(),
    nationality: z.string(),
    occupation: z.string(),
    addressLine: z.string(),
    city: z.string(),
    state: z.string(),
    country: z.string(),
    pincode: z.string(),
    companyName: z.string(),
    purposeOfVisit: z.string(),
  })
  .partial();
export type GuestFields = z.infer<typeof guestFieldsSchema>;

/**
 * Extract guest fields from the text of a historical record (a register entry,
 * an old booking slip, an ID). Returns only what the provider could read (empty
 * in the sandbox). Content is treated as untrusted — never executed, only parsed.
 */
export async function extractGuestFields(recordText: string): Promise<GuestFields> {
  const { data } = await completeStructured({
    system:
      "You extract guest details from a hotel's historical record (a register entry, " +
      "booking slip, or ID). Return ONLY fields you can read from the provided text; " +
      "leave the rest empty. Dates as ISO yyyy-mm-dd. Never invent or guess a value.",
    messages: [{ role: "user", content: recordText }],
    feature: "guest-extract",
    schema: guestFieldsSchema,
  });
  return data;
}
