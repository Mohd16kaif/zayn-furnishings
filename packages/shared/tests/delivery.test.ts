import { describe, expect, it } from "vitest";
import { computeDelivery } from "../src/delivery";

describe("computeDelivery", () => {
  it("uses the zone threshold ahead of the store setting", () => {
    const result = computeDelivery({
      zone: { feeCents: 4900, freeOverCents: 30000 },
      settingsThresholdCents: 10000,
      subtotalCents: 15000,
    });

    expect(result.isFree).toBe(false);
    expect(result.feeCents).toBe(4900);
    expect(result.freeOverCents).toBe(30000);
    expect(result.amountToFreeCents).toBe(15000);
  });

  it("uses the zone threshold when it qualifies the order", () => {
    const result = computeDelivery({
      zone: { feeCents: 4900, freeOverCents: 10000 },
      settingsThresholdCents: 20000,
      subtotalCents: 12000,
    });

    expect(result.isFree).toBe(true);
    expect(result.feeCents).toBe(0);
    expect(result.freeOverCents).toBe(10000);
    expect(result.amountToFreeCents).toBe(0);
  });

  it("falls back to the store threshold when the zone threshold is null", () => {
    const result = computeDelivery({
      zone: { feeCents: 4900, freeOverCents: null },
      settingsThresholdCents: 20000,
      subtotalCents: 20000,
    });

    expect(result.isFree).toBe(true);
    expect(result.feeCents).toBe(0);
    expect(result.freeOverCents).toBe(20000);
  });

  it("never marks an order free when both thresholds are null", () => {
    const result = computeDelivery({
      zone: { feeCents: 4900, freeOverCents: null },
      settingsThresholdCents: null,
      subtotalCents: 999999,
    });

    expect(result.isFree).toBe(false);
    expect(result.feeCents).toBe(4900);
    expect(result.freeOverCents).toBeNull();
    expect(result.amountToFreeCents).toBeNull();
  });

  it("treats a subtotal exactly at the threshold as free", () => {
    const result = computeDelivery({
      zone: { feeCents: 4900, freeOverCents: 10000 },
      settingsThresholdCents: null,
      subtotalCents: 10000,
    });

    expect(result.isFree).toBe(true);
    expect(result.feeCents).toBe(0);
  });

  it("treats a zero-fee zone as free even without a threshold", () => {
    const result = computeDelivery({
      zone: { feeCents: 0, freeOverCents: null },
      settingsThresholdCents: 20000,
      subtotalCents: 0,
    });

    expect(result.isFree).toBe(true);
    expect(result.feeCents).toBe(0);
    expect(result.amountToFreeCents).toBe(0);
  });

  it("reports the amount left to reach the threshold", () => {
    const result = computeDelivery({
      zone: { feeCents: 4900, freeOverCents: 15000 },
      settingsThresholdCents: null,
      subtotalCents: 5000,
    });

    expect(result.isFree).toBe(false);
    expect(result.feeCents).toBe(4900);
    expect(result.amountToFreeCents).toBe(10000);
  });
});
