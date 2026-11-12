import { describe, expect, it } from "vitest";
import {
  stateForZip,
  zipMatchesState,
  ZIP_PREFIX_STATE_RANGES,
} from "../src/zipState";

describe("zipMatchesState", () => {
  it.each([
    ["10001", "NY"],
    ["90210", "CA"],
    ["33101", "FL"],
    ["60601", "IL"],
    ["77001", "TX"],
    ["98101", "WA"],
    ["02108", "MA"],
    ["20001", "DC"],
    ["99501", "AK"],
  ])("accepts %s for %s", (zip, state) => {
    expect(zipMatchesState(zip, state)).toBe(true);
  });

  it("rejects a ZIP that belongs to another state", () => {
    expect(zipMatchesState("10001", "AL")).toBe(false);
  });

  it.each(["1234", "ABCDE", "00000", "", "10001-1234"])(
    "rejects invalid ZIP %s",
    (zip) => {
      expect(stateForZip(zip)).toBeNull();
      expect(zipMatchesState(zip, "NY")).toBe(false);
    },
  );

  it("rejects invalid state values", () => {
    expect(zipMatchesState("10001", "NYC")).toBe(false);
    expect(zipMatchesState("10001", "")).toBe(false);
  });

  it("covers all 50 states plus DC", () => {
    expect(new Set(ZIP_PREFIX_STATE_RANGES.map((range) => range.state)).size)
      .toBe(51);
  });
});
