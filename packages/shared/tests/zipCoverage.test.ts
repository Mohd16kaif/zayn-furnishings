import { describe, expect, it } from "vitest";
import {
  uncoveredZipRanges,
  type CoverageZone,
} from "../src/zipCoverage";

function zone(
  zipStart: string,
  zipEnd: string,
  isActive = true,
): CoverageZone {
  return { zipStart, zipEnd, isActive };
}

const FULL_RANGE = [
  { zip_start: "00000", zip_end: "99999" },
];

describe("uncoveredZipRanges", () => {
  it("returns no gaps when active zones cover every ZIP code", () => {
    expect(uncoveredZipRanges([zone("00000", "99999")])).toEqual([]);
  });

  it("returns the full range when there are no zones", () => {
    expect(uncoveredZipRanges([])).toEqual(FULL_RANGE);
  });

  it("finds a gap in the middle", () => {
    expect(
      uncoveredZipRanges([
        zone("00000", "19999"),
        zone("30000", "99999"),
      ]),
    ).toEqual([{ zip_start: "20000", zip_end: "29999" }]);
  });

  it("finds a gap at the start", () => {
    expect(uncoveredZipRanges([zone("10000", "99999")])).toEqual([
      { zip_start: "00000", zip_end: "09999" },
    ]);
  });

  it("finds a gap at the end", () => {
    expect(uncoveredZipRanges([zone("00000", "89999")])).toEqual([
      { zip_start: "90000", zip_end: "99999" },
    ]);
  });

  it("merges overlapping zones", () => {
    expect(
      uncoveredZipRanges([
        zone("00000", "50000"),
        zone("40000", "99999"),
      ]),
    ).toEqual([]);
  });

  it("merges adjacent zones across the 09999/10000 boundary", () => {
    expect(
      uncoveredZipRanges([
        zone("00000", "09999"),
        zone("10000", "99999"),
      ]),
    ).toEqual([]);
  });

  it("ignores inactive zones", () => {
    expect(
      uncoveredZipRanges([
        zone("00000", "99999", false),
      ]),
    ).toEqual(FULL_RANGE);
  });

  it("does not treat inactive zones as filling a gap", () => {
    expect(
      uncoveredZipRanges([
        zone("00000", "19999"),
        zone("20000", "29999", false),
        zone("30000", "99999"),
      ]),
    ).toEqual([{ zip_start: "20000", zip_end: "29999" }]);
  });
});
