import { parsePhoneNumberFromString } from "libphonenumber-js";

const PHONE_INPUT_PATTERN = /^[+\d\s().-]+$/;
const FAKE_NATIONAL_NUMBERS = new Set([
  "0000000000",
  "1111111111",
  "1234567890",
  "0123456789",
  "5555555555",
]);

/**
 * Normalizes a US phone number to E.164 (+1XXXXXXXXXX).
 * Returns null for non-US, invalid, malformed, or obviously fake numbers.
 */
export function normalizeUsPhone(input: string): string | null {
  const trimmed = input.trim();

  if (!trimmed || !PHONE_INPUT_PATTERN.test(trimmed)) {
    return null;
  }

  const parsed = parsePhoneNumberFromString(trimmed, "US");

  if (!parsed || parsed.country !== "US" || !parsed.isValid()) {
    return null;
  }

  const nationalNumber = parsed.nationalNumber;

  if (nationalNumber.length !== 10) {
    return null;
  }

  if (
    FAKE_NATIONAL_NUMBERS.has(nationalNumber) ||
    /^(\d)\1{9}$/.test(nationalNumber)
  ) {
    return null;
  }

  return parsed.format("E.164");
}
