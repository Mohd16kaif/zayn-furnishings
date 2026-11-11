export type CoverageZone = {
  zipStart: string;
  zipEnd: string;
  isActive: boolean;
};

export type ZipRange = {
  zip_start: string;
  zip_end: string;
};

const ZIP_MIN = 0;
const ZIP_MAX = 99999;

function padZip(value: number): string {
  return String(value).padStart(5, "0");
}

/**
 * Merges the uncovered parts of 00000-99999 for the active zones.
 * Overlapping and adjacent active zones are merged before gaps are
 * calculated, so the result contains contiguous ranges only.
 */
export function uncoveredZipRanges(
  zones: CoverageZone[],
): ZipRange[] {
  const intervals = zones
    .filter((zone) => zone.isActive)
    .map((zone) => [
      Number(zone.zipStart),
      Number(zone.zipEnd),
    ])
    .filter(
      ([start, end]) =>
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        start <= end,
    )
    .sort((a, b) => a[0] - b[0]);

  const merged: Array<[number, number]> = [];

  for (const interval of intervals) {
    const last = merged[merged.length - 1];

    if (last && interval[0] <= last[1] + 1) {
      last[1] = Math.max(last[1], interval[1]);
    } else {
      merged.push([interval[0], interval[1]]);
    }
  }

  const gaps: ZipRange[] = [];
  let cursor = ZIP_MIN;

  for (const [start, end] of merged) {
    if (start > cursor) {
      gaps.push({
        zip_start: padZip(cursor),
        zip_end: padZip(start - 1),
      });
    }

    cursor = Math.max(cursor, end + 1);
  }

  if (cursor <= ZIP_MAX) {
    gaps.push({
      zip_start: padZip(cursor),
      zip_end: padZip(ZIP_MAX),
    });
  }

  return gaps;
}
