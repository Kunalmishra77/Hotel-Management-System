/**
 * Compliance config flags — the SINGLE home (compliance.md § Config flags).
 *
 * These are the client's legal calls, gated behind flags so the strict/masked
 * defaults can be relaxed before go-live without a code change — and never
 * weakened silently. Read from env so a deployment sets them; defaults are the
 * safe (strict) values.
 */

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  return raw === "true" || raw === "1" || raw.toLowerCase() === "yes";
}

/**
 * Store the full Aadhaar number/scan? Default OFF — masked last-4 only (FR-4).
 * The client turns this on only with acknowledged legal risk (compliance.md).
 */
export function isFullAadhaarStorageEnabled(): boolean {
  return envFlag("COMPLIANCE_STORE_FULL_AADHAAR", false);
}

/**
 * Mask PII in lists/search/exports unless the caller has permission + reason?
 * Default ON (compliance.md, 04 FR-8).
 */
export function isPiiMaskedInLists(): boolean {
  return envFlag("PII_MASK_IN_LISTS", true);
}

/** DPDP data-residency region for DB/backups/object storage. */
export function dataRegion(): string {
  return process.env.DATA_REGION ?? "ap-south-1";
}
