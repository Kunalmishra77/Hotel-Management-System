/** Plain-language labels for sent messages (log, guest conversation, detail popup). */

export const CHANNEL_LABEL: Record<string, string> = { WHATSAPP: "WhatsApp", EMAIL: "Email", SMS: "SMS" };

const TEMPLATE_TITLE: Record<string, string> = {
  BOOKING_CONFIRMATION: "Booking confirmation",
  WELCOME_CHECKIN: "Welcome / check-in",
  CHECKOUT_THANKYOU: "Thank you after check-out",
  PRE_ARRIVAL: "Before arrival",
  INVOICE_SHARE: "Invoice shared",
  FOLLOWUP_10D: "Follow-up (10 days after stay)",
};

const prettify = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export function messageTitle(templateKey: string | null, category: string | null): string {
  if (templateKey) return TEMPLATE_TITLE[templateKey] ?? prettify(templateKey);
  return category ? prettify(category) : "Message";
}

/** A sandbox "send" never left the building — say so instead of "Delivered". */
export function statusLabel(status: string, sandbox: boolean): string {
  if (sandbox && (status === "SENT" || status === "DELIVERED" || status === "READ")) return "Not sent (test mode)";
  switch (status) {
    case "QUEUED": return "Waiting to send";
    case "SENT": return "Sent";
    case "DELIVERED": return "Delivered";
    case "READ": return "Read";
    case "FAILED": return "Failed";
    default: return prettify(status);
  }
}
