/**
 * The one "how was this paid?" picker — used wherever money is recorded (booking
 * advance, already-paid OTA stays, extensions, check-in). Starts EMPTY unless a
 * default is given, so a payment is never silently saved as Cash.
 */
export const PAYMENT_MODE_OPTIONS = [
  { value: "UPI", label: "UPI" },
  { value: "CASH", label: "Cash" },
  { value: "CREDIT_CARD", label: "Credit card" },
  { value: "DEBIT_CARD", label: "Debit card" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "ONLINE", label: "Online / OTA prepaid" },
] as const;
export type PaymentModeValue = (typeof PAYMENT_MODE_OPTIONS)[number]["value"];

export function PaymentModeSelect({
  value,
  onChange,
  id,
  name,
  required,
  testId,
  className,
}: {
  value: string;
  onChange: (v: PaymentModeValue | "") => void;
  id?: string;
  name?: string;
  required?: boolean;
  testId?: string;
  className?: string;
}) {
  return (
    <select
      id={id}
      name={name}
      value={value}
      required={required}
      onChange={(e) => onChange(e.target.value as PaymentModeValue | "")}
      className={className ?? "h-10 w-full rounded-md border border-input bg-background px-3 text-sm"}
      aria-invalid={required && !value ? true : undefined}
      data-testid={testId}
    >
      <option value="">Select payment mode…</option>
      {PAYMENT_MODE_OPTIONS.map((m) => (
        <option key={m.value} value={m.value}>{m.label}</option>
      ))}
    </select>
  );
}
