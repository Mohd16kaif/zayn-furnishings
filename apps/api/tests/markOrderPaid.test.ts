import { describe, expect, it } from "vitest";
import {
  decidePaidTransition,
  succeededPaymentRawEventId,
} from "../src/lib/markOrderPaid";

describe("markOrderPaid helpers", () => {
  it("uses one deterministic raw event id for every succeeded path", () => {
    expect(succeededPaymentRawEventId("pi_123")).toBe("pi_succeeded:pi_123");
    expect(succeededPaymentRawEventId("pi_123")).toBe(
      succeededPaymentRawEventId("pi_123"),
    );
  });

  it("only marks a pending order with the exact total", () => {
    expect(decidePaidTransition("pending", 12500, 12500)).toBe("mark_paid");
    expect(decidePaidTransition("pending", 12499, 12500)).toBe(
      "amount_mismatch",
    );
    expect(decidePaidTransition("pending", 12501, 12500)).toBe(
      "amount_mismatch",
    );
  });

  it("never processes an order twice", () => {
    expect(decidePaidTransition("paid", 12500, 12500)).toBe(
      "already_processed",
    );
    expect(decidePaidTransition("processing", 12500, 12500)).toBe(
      "already_processed",
    );
    expect(decidePaidTransition("cancelled", 12500, 12500)).toBe(
      "already_processed",
    );
  });
});
