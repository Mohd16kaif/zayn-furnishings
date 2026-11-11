import { describe, expect, it } from "vitest";
import {
  CONTENT_TYPE_LIMITS,
  validateContentDateRange,
  validateContentLink,
} from "../src/content";

describe("validateContentLink", () => {
  it("accepts an https URL", () => {
    expect(
      validateContentLink("https://example.com/collections/sofas"),
    ).toBeNull();
  });

  it("accepts a relative path", () => {
    expect(validateContentLink("/c/sofas")).toBeNull();
  });

  it("rejects a protocol-relative URL", () => {
    expect(validateContentLink("//evil.com")).not.toBeNull();
  });

  it("rejects javascript URLs", () => {
    expect(validateContentLink("javascript:alert(1)")).not.toBeNull();
  });

  it("rejects data URLs", () => {
    expect(validateContentLink("data:text/html,hello")).not.toBeNull();
  });

  it("rejects plain http URLs", () => {
    expect(validateContentLink("http://example.com")).not.toBeNull();
  });

  it("accepts an empty link", () => {
    expect(validateContentLink("")).toBeNull();
    expect(validateContentLink(null)).toBeNull();
  });
});

describe("validateContentDateRange", () => {
  it("accepts an end date after the start date", () => {
    expect(
      validateContentDateRange(
        "2026-01-01T00:00:00.000Z",
        "2026-02-01T00:00:00.000Z",
      ),
    ).toBeNull();
  });

  it("rejects an end date before the start date", () => {
    expect(
      validateContentDateRange(
        "2026-02-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      ),
    ).not.toBeNull();
  });

  it("rejects an end date equal to the start date", () => {
    expect(
      validateContentDateRange(
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      ),
    ).not.toBeNull();
  });

  it("accepts a missing start or end date", () => {
    expect(validateContentDateRange(null, null)).toBeNull();
    expect(
      validateContentDateRange("2026-01-01T00:00:00.000Z", null),
    ).toBeNull();
    expect(
      validateContentDateRange(null, "2026-01-01T00:00:00.000Z"),
    ).toBeNull();
  });
});

describe("content type limits", () => {
  it("matches the configured active limits", () => {
    expect(CONTENT_TYPE_LIMITS).toEqual({
      announcement: 3,
      hero: 6,
      promo_card: 2,
      room_tile: 8,
      info_card: 6,
      faq: 20,
    });
  });
});
