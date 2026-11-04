/**
 * Email subject lines per template key — one source for the SMTP adapter (what
 * the guest receives) and the message viewer (what staff see was sent). Email
 * needs a subject; the body is the rendered template. A key with no entry falls
 * back to the company name.
 */
const SUBJECTS: Record<string, string> = {
  BOOKING_CONFIRMATION: "Your booking is confirmed",
  WELCOME_CHECKIN: "Welcome — you're checked in",
  CHECKOUT_THANKYOU: "Thank you for your stay",
  PRE_ARRIVAL: "We look forward to your arrival",
  INVOICE_SHARE: "Your invoice",
};
const DEFAULT_SUBJECT = "Woodpecker Apartments & Suites";

export function emailSubject(templateKey: string | null | undefined): string {
  return (templateKey && SUBJECTS[templateKey]) || DEFAULT_SUBJECT;
}
