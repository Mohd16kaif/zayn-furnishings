export type ZipPrefixStateRange = {
  start: number;
  end: number;
  state: string;
};

/**
 * USPS ZIP prefix (first three digits) to state ranges. This intentionally
 * covers the 50 states and DC only; territories and military prefixes are
 * not deliverable states for the storefront.
 */
export const ZIP_PREFIX_STATE_RANGES: readonly ZipPrefixStateRange[] = [
  { start: 5, end: 5, state: "NY" },
  { start: 10, end: 27, state: "MA" },
  { start: 28, end: 29, state: "RI" },
  { start: 30, end: 38, state: "NH" },
  { start: 39, end: 49, state: "ME" },
  { start: 50, end: 59, state: "VT" },
  { start: 60, end: 69, state: "CT" },
  { start: 70, end: 89, state: "NJ" },
  { start: 100, end: 149, state: "NY" },
  { start: 150, end: 196, state: "PA" },
  { start: 197, end: 199, state: "DE" },
  { start: 200, end: 205, state: "DC" },
  { start: 206, end: 219, state: "MD" },
  { start: 220, end: 246, state: "VA" },
  { start: 247, end: 268, state: "WV" },
  { start: 270, end: 289, state: "NC" },
  { start: 290, end: 299, state: "SC" },
  { start: 300, end: 319, state: "GA" },
  { start: 320, end: 339, state: "FL" },
  { start: 341, end: 349, state: "FL" },
  { start: 350, end: 369, state: "AL" },
  { start: 370, end: 385, state: "TN" },
  { start: 386, end: 397, state: "MS" },
  { start: 398, end: 399, state: "GA" },
  { start: 400, end: 427, state: "KY" },
  { start: 430, end: 459, state: "OH" },
  { start: 460, end: 479, state: "IN" },
  { start: 480, end: 499, state: "MI" },
  { start: 500, end: 528, state: "IA" },
  { start: 530, end: 549, state: "WI" },
  { start: 550, end: 567, state: "MN" },
  { start: 570, end: 577, state: "SD" },
  { start: 580, end: 588, state: "ND" },
  { start: 590, end: 599, state: "MT" },
  { start: 600, end: 629, state: "IL" },
  { start: 630, end: 658, state: "MO" },
  { start: 660, end: 679, state: "KS" },
  { start: 680, end: 693, state: "NE" },
  { start: 700, end: 714, state: "LA" },
  { start: 716, end: 729, state: "AR" },
  { start: 730, end: 749, state: "OK" },
  { start: 750, end: 799, state: "TX" },
  { start: 800, end: 816, state: "CO" },
  { start: 820, end: 831, state: "WY" },
  { start: 832, end: 838, state: "ID" },
  { start: 840, end: 847, state: "UT" },
  { start: 850, end: 865, state: "AZ" },
  { start: 870, end: 884, state: "NM" },
  { start: 885, end: 885, state: "TX" },
  { start: 889, end: 898, state: "NV" },
  { start: 900, end: 961, state: "CA" },
  { start: 967, end: 968, state: "HI" },
  { start: 970, end: 979, state: "OR" },
  { start: 980, end: 994, state: "WA" },
  { start: 995, end: 999, state: "AK" },
];

const PREFIX_STATE = new Map<number, string>();

for (const range of ZIP_PREFIX_STATE_RANGES) {
  for (let prefix = range.start; prefix <= range.end; prefix += 1) {
    if (!PREFIX_STATE.has(prefix)) {
      PREFIX_STATE.set(prefix, range.state);
    }
  }
}

export function stateForZip(zip: string): string | null {
  const trimmed = zip.trim();

  if (!/^\d{5}$/.test(trimmed)) {
    return null;
  }

  return PREFIX_STATE.get(Number(trimmed.slice(0, 3))) ?? null;
}

export function zipMatchesState(zip: string, state: string): boolean {
  const normalizedState = state.trim().toUpperCase();

  if (!/^[A-Z]{2}$/.test(normalizedState)) {
    return false;
  }

  return stateForZip(zip) === normalizedState;
}
