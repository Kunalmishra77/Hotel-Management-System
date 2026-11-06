/** The booking sources the desk can pick, with their front-desk labels. */
export const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: "DIRECT", label: "Direct" },
  { value: "WALK_IN", label: "Walk-in" },
  { value: "PHONE", label: "Phone / enquiry" },
  { value: "WEBSITE", label: "Website" },
  { value: "CORPORATE", label: "Corporate" },
  { value: "TRAVEL_AGENT", label: "Travel agent" },
  { value: "BOOKING_COM", label: "Booking.com" },
  { value: "MAKEMYTRIP", label: "MakeMyTrip" },
  { value: "EXPEDIA", label: "Expedia" },
  { value: "AGODA", label: "Agoda" },
  { value: "GOIBIBO", label: "Goibibo" },
  { value: "AIRBNB", label: "Airbnb" },
];

export const sourceOptionLabel = (v: string): string => SOURCE_OPTIONS.find((s) => s.value === v)?.label ?? v;
