/**
 * Registered company (legal entity) details printed on the GST tax invoice header.
 *
 * These are the invoice's "seller" identity — the same across all properties (one
 * legal entity). Transcribed from the client's letterhead; VERIFY the GSTIN, CIN
 * and email against the official document and correct here if a character differs.
 * Property-specific bits (branch address, place of supply) still come from the
 * Property row; this is only the legal-entity header.
 */
export const COMPANY_INFO = {
  legalName: "M/s Woodpecker Apartments & Suites Private Limited",
  regOfficeLines: ["Reg. Office: Khilonewala House,", "A-2, Hauz Khas, New Delhi-110016"],
  gstin: "07AAACW8105D1ZM",
  stateName: "Delhi",
  stateCode: "07",
  cin: "U74140DL2009PTC181581",
  email: "info@woodpecker4me.com",
} as const;

/** Booking-source enum → the label shown on the invoice ("Booking source"). */
export const BOOKING_SOURCE_LABEL: Record<string, string> = {
  DIRECT: "Direct",
  WEBSITE: "Website",
  PHONE: "Phone",
  WALK_IN: "Walk-in",
  AIRBNB: "Airbnb",
  BOOKING_COM: "Booking.com",
  AGODA: "Agoda",
  MAKEMYTRIP: "MakeMyTrip",
  GOIBIBO: "Goibibo",
  CORPORATE: "Corporate",
  TRAVEL_AGENT: "Travel Agent",
};

/** Payment-mode enum → the label shown on the invoice ("Payment method"). */
export const PAYMENT_MODE_LABEL: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  CREDIT_CARD: "Credit Card",
  DEBIT_CARD: "Debit Card",
  BANK_TRANSFER: "Bank Transfer",
  ONLINE: "Online",
  CORPORATE_CREDIT: "Corporate Credit",
};
