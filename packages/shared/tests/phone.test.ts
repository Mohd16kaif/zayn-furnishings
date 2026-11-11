import { describe, expect, it } from "vitest";
import { normalizeUsPhone } from "../src/phone";

describe("normalizeUsPhone", () => {
  it("accepts an E.164 US number", () => {
    expect(normalizeUsPhone("+14155550123")).toBe("+14155550123");
  });

  it("accepts a number with parentheses and dashes", () => {
    expect(normalizeUsPhone("(415) 555-0123")).toBe("+14155550123");
  });

  it("accepts spaces and dashes", () => {
    expect(normalizeUsPhone("415 555 0123")).toBe("+14155550123");
    expect(normalizeUsPhone("415-555-0123")).toBe("+14155550123");
  });

  it("accepts a leading country code without a plus", () => {
    expect(normalizeUsPhone("1 415 555 0123")).toBe("+14155550123");
  });

  it("accepts dots as separators", () => {
    expect(normalizeUsPhone("+1.415.555.0123")).toBe("+14155550123");
  });

  it("rejects non-US numbers", () => {
    expect(normalizeUsPhone("+442079460958")).toBeNull();
  });

  it("rejects numbers that are too short", () => {
    expect(normalizeUsPhone("+1 415 555")).toBeNull();
  });

  it("rejects numbers containing letters", () => {
    expect(normalizeUsPhone("+1 415 ABC 0123")).toBeNull();
  });

  it("rejects obviously fake repeated numbers", () => {
    expect(normalizeUsPhone("+1 111 111 1111")).toBeNull();
  });

  it("rejects an invalid US number", () => {
    expect(normalizeUsPhone("+1 123 456 7890")).toBeNull();
  });

  it("rejects empty input", () => {
    expect(normalizeUsPhone("   ")).toBeNull();
  });
});
