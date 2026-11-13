import { describe, expect, it } from "vitest";
import {
  appendOrderNote,
  escapeLikePattern,
  formatNoteTimestamp,
  hasStockShortage,
} from "../src/routes/adminOrders";

describe("escapeLikePattern", () => {
  it("escapes wildcard and escape characters", () => {
    expect(escapeLikePattern("50%_off")).toBe("50\\%\\_off");
    expect(escapeLikePattern("back\\slash")).toBe("back\\\\slash");
    expect(escapeLikePattern("%_\\%_")).toBe("\\%\\_\\\\\\%\\_");
  });

  it("leaves ordinary search text unchanged", () => {
    expect(escapeLikePattern("ZF-100001")).toBe("ZF-100001");
    expect(escapeLikePattern("Jane Doe")).toBe("Jane Doe");
  });
});

describe("hasStockShortage", () => {
  it("detects the STOCK SHORTAGE note appended by markOrderPaid", () => {
    expect(
      hasStockShortage(
        "STOCK SHORTAGE: needs manual review (Chair: requested 2, available 1)",
      ),
    ).toBe(true);
    expect(hasStockShortage("stock shortage: needs manual review")).toBe(
      true,
    );
  });

  it("ignores empty notes and unrelated notes", () => {
    expect(hasStockShortage(null)).toBe(false);
    expect(hasStockShortage(undefined)).toBe(false);
    expect(hasStockShortage("")).toBe(false);
    expect(hasStockShortage("Customer asked for a later delivery.")).toBe(
      false,
    );
  });
});

describe("appendOrderNote", () => {
  const now = new Date("2026-11-13T09:05:00.000Z");

  it("formats the timestamp in UTC", () => {
    expect(formatNoteTimestamp(now)).toBe("2026-11-13 09:05 UTC");
  });

  it("appends a new line without overwriting existing notes", () => {
    const existing =
      "STOCK SHORTAGE: needs manual review (Chair: requested 2, available 1)";
    const result = appendOrderNote(
      existing,
      "Owner <owner@example.com>",
      "Called the customer.",
      now,
    );

    expect(result).toBe(
      `${existing}\n[2026-11-13 09:05 UTC] Owner <owner@example.com>: Called the customer.`,
    );
  });

  it("starts the notes field when it is empty", () => {
    expect(
      appendOrderNote(null, "owner@example.com", "First note.", now),
    ).toBe("[2026-11-13 09:05 UTC] owner@example.com: First note.");
    expect(
      appendOrderNote("", "owner@example.com", "First note.", now),
    ).toBe("[2026-11-13 09:05 UTC] owner@example.com: First note.");
  });
});
