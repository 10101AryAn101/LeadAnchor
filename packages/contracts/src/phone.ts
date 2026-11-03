import { parsePhoneNumberFromString } from "libphonenumber-js";

/** Normalises a US phone number to E.164 (+15551234567). Returns null when it is not a valid number. */
export function toE164(input: string, defaultCountry: "US" = "US"): string | null {
  const parsed = parsePhoneNumberFromString(input.trim(), defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

/** The US and its territories: numbers US carriers text under the business's registration. */
const US_REGIONS: ReadonlySet<string> = new Set(["US", "PR", "VI", "GU", "AS", "MP"]);

/**
 * Like toE164, for numbers people type into forms: only US ones count, so "+91 …" or a
 * Canadian number gives null instead of passing as a US mobile.
 */
export function toUsE164(input: string): string | null {
  const parsed = parsePhoneNumberFromString(input.trim(), "US");
  if (!parsed?.isValid() || !parsed.country || !US_REGIONS.has(parsed.country)) return null;
  return parsed.number;
}

/** Formats an E.164 number for people: (555) 123-4567 for US numbers. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "Unknown number";
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  return parsed.country === "US" || parsed.country === "CA" ? parsed.formatNational() : parsed.formatInternational();
}
