/**
 * amountInWords — 06 T-7 (FR-16, AC-16). Indian numbering (thousand / lakh /
 * crore) for the GST invoice's "amount in words" line.
 *
 *   1341000 paise → "Rupees Thirteen Thousand Four Hundred Ten Only"
 *   150050  paise → "Rupees One Thousand Five Hundred and Fifty Paise Only"
 */
const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
  "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** 0–99 → words (99 is the largest chunk in the Indian grouping). */
function twoDigits(n: number): string {
  if (n < 20) return ONES[n]!;
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o === 0 ? TENS[t]! : `${TENS[t]} ${ONES[o]}`;
}

/** A whole rupee amount in Indian-numbered words (no "Rupees"/"Only" wrapper). */
function rupeesToWords(rupees: number): string {
  if (rupees === 0) return "Zero";
  const crore = Math.floor(rupees / 10_000_000);
  const lakh = Math.floor((rupees % 10_000_000) / 100_000);
  const thousand = Math.floor((rupees % 100_000) / 1_000);
  const hundred = Math.floor((rupees % 1_000) / 100);
  const rest = rupees % 100;

  const parts: string[] = [];
  if (crore) parts.push(`${rupeesToWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(" ");
}

export function amountInWords(paise: bigint | number): string {
  const total = Number(BigInt(paise));
  const rupees = Math.floor(total / 100);
  const paisa = total % 100;
  const rupeeWords = `Rupees ${rupeesToWords(rupees)}`;
  const paisaWords = paisa > 0 ? ` and ${twoDigits(paisa)} Paise` : "";
  return `${rupeeWords}${paisaWords} Only`;
}
