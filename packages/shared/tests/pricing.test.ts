import { describe, expect, it } from "vitest";
import {
  calculateDiscountCents,
  calculateOrderTotals,
  calculateStockDeduction,
  calculateTaxCents,
  evaluateDiscountCode,
  type DiscountRule,
} from "../src/pricing";

const NOW = new Date("2026-06-15T12:00:00.000Z");

function discountRule(overrides: Partial<DiscountRule> = {}): DiscountRule {
  return {
    type: "percent",
    value: 10,
    minOrderCents: 0,
    startsAt: null,
    endsAt: null,
    usageLimit: null,
    usedCount: 0,
    isActive: true,
    ...overrides,
  };
}

describe("calculateOrderTotals", () => {
  it("adds the delivery fee and keeps everything in integer cents", () => {
    const totals = calculateOrderTotals({
      subtotalCents: 10000,
      deliveryFeeCents: 4900,
      taxCents: 0,
    });

    expect(totals).toEqual({
      subtotalCents: 10000,
      discountCents: 0,
      deliveryFeeCents: 4900,
      taxCents: 0,
      totalCents: 14900,
    });
  });

  it("subtracts a percent discount", () => {
    const discountCents = calculateDiscountCents(10000, {
      type: "percent",
      value: 10,
    });

    const totals = calculateOrderTotals({
      subtotalCents: 10000,
      discountCents,
      deliveryFeeCents: 4900,
    });

    expect(discountCents).toBe(1000);
    expect(totals.totalCents).toBe(13900);
  });

  it("supports a 100 percent discount without making the order negative", () => {
    const discountCents = calculateDiscountCents(8500, {
      type: "percent",
      value: 100,
    });

    const totals = calculateOrderTotals({
      subtotalCents: 8500,
      discountCents,
      deliveryFeeCents: 4900,
    });

    expect(discountCents).toBe(8500);
    expect(totals.discountCents).toBe(8500);
    expect(totals.totalCents).toBe(4900);
  });

  it("rounds percent discounts to whole cents", () => {
    expect(
      calculateDiscountCents(1999, { type: "percent", value: 10 }),
    ).toBe(200);
  });

  it("supports a fixed discount", () => {
    expect(
      calculateDiscountCents(5000, { type: "fixed", value: 2500 }),
    ).toBe(2500);
  });

  it("caps a fixed discount that is larger than the subtotal", () => {
    const discountCents = calculateDiscountCents(5000, {
      type: "fixed",
      value: 9000,
    });

    const totals = calculateOrderTotals({
      subtotalCents: 5000,
      discountCents,
      deliveryFeeCents: 0,
    });

    expect(discountCents).toBe(5000);
    expect(totals.totalCents).toBe(0);
  });

  it("never lets the discount or total go below zero", () => {
    const totals = calculateOrderTotals({
      subtotalCents: 1000,
      discountCents: 5000,
      deliveryFeeCents: 0,
      taxCents: 0,
    });

    expect(totals.discountCents).toBe(1000);
    expect(totals.totalCents).toBe(0);
  });

  it("clamps negative inputs instead of producing negative money", () => {
    const totals = calculateOrderTotals({
      subtotalCents: -500,
      discountCents: -100,
      deliveryFeeCents: -4900,
      taxCents: -1,
    });

    expect(totals).toEqual({
      subtotalCents: 0,
      discountCents: 0,
      deliveryFeeCents: 0,
      taxCents: 0,
      totalCents: 0,
    });
  });

  it("returns zero tax until Stripe Tax replaces the placeholder", () => {
    expect(calculateTaxCents(12345, { state: "NY", zip: "10001" })).toBe(0);
    expect(calculateTaxCents(0, { state: null, zip: null })).toBe(0);
  });
});

describe("evaluateDiscountCode", () => {
  it("accepts an active percent code and calculates its discount", () => {
    const result = evaluateDiscountCode(
      discountRule({ value: 15 }),
      10000,
      NOW,
    );

    expect(result).toEqual({ eligible: true, discountCents: 1500 });
  });

  it("accepts an active fixed code", () => {
    const result = evaluateDiscountCode(
      discountRule({ type: "fixed", value: 2000 }),
      10000,
      NOW,
    );

    expect(result).toEqual({ eligible: true, discountCents: 2000 });
  });

  it("rejects an inactive code", () => {
    expect(
      evaluateDiscountCode(discountRule({ isActive: false }), 10000, NOW),
    ).toEqual({ eligible: false, reason: "inactive" });
  });

  it("rejects a code that has not started yet", () => {
    expect(
      evaluateDiscountCode(
        discountRule({
          startsAt: "2026-07-01T00:00:00.000Z",
        }),
        10000,
        NOW,
      ),
    ).toEqual({ eligible: false, reason: "not_started" });
  });

  it("rejects an expired code", () => {
    expect(
      evaluateDiscountCode(
        discountRule({
          endsAt: "2026-06-01T00:00:00.000Z",
        }),
        10000,
        NOW,
      ),
    ).toEqual({ eligible: false, reason: "expired" });
  });

  it("rejects a code when the minimum order is not met", () => {
    expect(
      evaluateDiscountCode(
        discountRule({ minOrderCents: 15000 }),
        10000,
        NOW,
      ),
    ).toEqual({ eligible: false, reason: "min_order" });
  });

  it("accepts a code exactly at the minimum order", () => {
    expect(
      evaluateDiscountCode(
        discountRule({ minOrderCents: 10000 }),
        10000,
        NOW,
      ),
    ).toEqual({ eligible: true, discountCents: 1000 });
  });

  it("rejects a code that has reached its usage limit", () => {
    expect(
      evaluateDiscountCode(
        discountRule({ usageLimit: 5, usedCount: 5 }),
        10000,
        NOW,
      ),
    ).toEqual({ eligible: false, reason: "usage_limit" });
  });

  it("accepts a code with no usage limit even after many uses", () => {
    expect(
      evaluateDiscountCode(
        discountRule({ usageLimit: null, usedCount: 500 }),
        10000,
        NOW,
      ),
    ).toEqual({ eligible: true, discountCents: 1000 });
  });

  it("rejects a code with a non-positive value", () => {
    expect(
      evaluateDiscountCode(discountRule({ value: 0 }), 10000, NOW),
    ).toEqual({ eligible: false, reason: "invalid_value" });
  });

  it("caps a percent value above 100 at the subtotal", () => {
    expect(
      evaluateDiscountCode(discountRule({ value: 150 }), 10000, NOW),
    ).toEqual({ eligible: true, discountCents: 10000 });
  });
});

describe("calculateStockDeduction", () => {
  it("clamps a shortage and reports what remains", () => {
    expect(calculateStockDeduction(5, 3)).toEqual({
      requestedQty: 5,
      availableQty: 3,
      appliedQty: 3,
      shortfallQty: 2,
      remainingQty: 0,
    });
  });

  it("applies nothing when stock is zero", () => {
    expect(calculateStockDeduction(4, 0)).toEqual({
      requestedQty: 4,
      availableQty: 0,
      appliedQty: 0,
      shortfallQty: 4,
      remainingQty: 0,
    });
  });

  it("keeps the unused stock when there is enough", () => {
    expect(calculateStockDeduction(2, 9)).toEqual({
      requestedQty: 2,
      availableQty: 9,
      appliedQty: 2,
      shortfallQty: 0,
      remainingQty: 7,
    });
  });

  it("clamps negative quantities instead of increasing stock", () => {
    expect(calculateStockDeduction(-3, -2)).toEqual({
      requestedQty: 0,
      availableQty: 0,
      appliedQty: 0,
      shortfallQty: 0,
      remainingQty: 0,
    });
  });
});
