import { describe, expect, it } from "vitest";
import {
  ORDER_STATUSES,
  canTransition,
  isBackwardFulfillmentTransition,
  isManualStatusBlocked,
  type AdminRole,
  type OrderStatus,
} from "../src/orderTransitions";

const FORWARD_PAIRS = new Set([
  "pending->cancelled",
  "paid->processing",
  "paid->out_for_delivery",
  "paid->delivered",
  "processing->out_for_delivery",
  "processing->delivered",
  "out_for_delivery->delivered",
]);

const OWNER_BACKWARD_PAIRS = new Set([
  "out_for_delivery->processing",
  "delivered->processing",
  "delivered->out_for_delivery",
]);

function expectedCanTransition(
  from: OrderStatus,
  to: OrderStatus,
  role: AdminRole,
): boolean {
  const key = `${from}->${to}`;

  if (FORWARD_PAIRS.has(key)) {
    return true;
  }

  return role === "owner" && OWNER_BACKWARD_PAIRS.has(key);
}

describe("canTransition", () => {
  for (const role of ["owner", "staff"] as const) {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        it(`${role}: ${from} -> ${to}`, () => {
          expect(canTransition(from, to, role)).toBe(
            expectedCanTransition(from, to, role),
          );
        });
      }
    }
  }

  it("never allows payment states to be set by hand", () => {
    for (const role of ["owner", "staff"] as const) {
      for (const from of ORDER_STATUSES) {
        expect(canTransition(from, "pending", role)).toBe(false);
        expect(canTransition(from, "paid", role)).toBe(false);
        expect(canTransition(from, "refunded", role)).toBe(false);
        expect(canTransition(from, "partially_refunded", role)).toBe(false);
      }
    }
  });

  it("only allows cancelling from pending", () => {
    for (const role of ["owner", "staff"] as const) {
      expect(canTransition("pending", "cancelled", role)).toBe(true);

      for (const from of ORDER_STATUSES) {
        if (from !== "pending") {
          expect(canTransition(from, "cancelled", role)).toBe(false);
        }
      }
    }
  });

  it("only owners can move backward along the fulfillment chain", () => {
    expect(canTransition("delivered", "processing", "owner")).toBe(true);
    expect(canTransition("delivered", "processing", "staff")).toBe(false);
    expect(canTransition("out_for_delivery", "processing", "staff")).toBe(
      false,
    );
    expect(canTransition("processing", "paid", "owner")).toBe(false);
  });
});

describe("isBackwardFulfillmentTransition", () => {
  it("flags only earlier fulfillment statuses", () => {
    expect(isBackwardFulfillmentTransition("delivered", "processing")).toBe(
      true,
    );
    expect(
      isBackwardFulfillmentTransition("out_for_delivery", "paid"),
    ).toBe(true);
    expect(isBackwardFulfillmentTransition("paid", "delivered")).toBe(false);
    expect(isBackwardFulfillmentTransition("pending", "delivered")).toBe(false);
    expect(isBackwardFulfillmentTransition("cancelled", "paid")).toBe(false);
  });
});

describe("isManualStatusBlocked", () => {
  it("blocks pending, paid, refunded, and partially_refunded", () => {
    expect(isManualStatusBlocked("pending")).toBe(true);
    expect(isManualStatusBlocked("paid")).toBe(true);
    expect(isManualStatusBlocked("refunded")).toBe(true);
    expect(isManualStatusBlocked("partially_refunded")).toBe(true);
    expect(isManualStatusBlocked("processing")).toBe(false);
    expect(isManualStatusBlocked("cancelled")).toBe(false);
  });
});
