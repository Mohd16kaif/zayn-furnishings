import { describe, expect, it } from "vitest";
import {
  deliveryEmailEvents,
  type DeliveryEmailSnapshot,
} from "../src/deliveryEmails";

function snapshot(
  overrides: Partial<DeliveryEmailSnapshot> = {},
): DeliveryEmailSnapshot {
  return {
    orderStatus: "paid",
    deliveryStatus: "pending",
    scheduledDate: null,
    timeWindow: null,
    ...overrides,
  };
}

function events(
  before: Partial<DeliveryEmailSnapshot>,
  after: Partial<DeliveryEmailSnapshot>,
) {
  return deliveryEmailEvents({
    before: snapshot(before),
    after: snapshot(after),
  });
}

describe("deliveryEmailEvents", () => {
  it("returns nothing when nothing relevant changed", () => {
    expect(events({}, {})).toEqual([]);
    expect(
      events(
        {
          orderStatus: "processing",
          deliveryStatus: "scheduled",
          scheduledDate: "2026-11-14",
          timeWindow: "Morning",
        },
        {
          orderStatus: "processing",
          deliveryStatus: "scheduled",
          scheduledDate: "2026-11-14",
          timeWindow: "Morning",
        },
      ),
    ).toEqual([]);
  });

  it("returns delivery_scheduled when a date is set on a paid order", () => {
    expect(
      events(
        { deliveryStatus: "pending" },
        {
          deliveryStatus: "scheduled",
          scheduledDate: "2026-11-14",
        },
      ),
    ).toEqual(["delivery_scheduled"]);
  });

  it("returns delivery_scheduled when the date changes", () => {
    expect(
      events(
        {
          deliveryStatus: "scheduled",
          scheduledDate: "2026-11-14",
        },
        {
          deliveryStatus: "scheduled",
          scheduledDate: "2026-11-20",
        },
      ),
    ).toEqual(["delivery_scheduled"]);
  });

  it("returns delivery_scheduled when the time window changes while a date is set", () => {
    expect(
      events(
        {
          deliveryStatus: "scheduled",
          scheduledDate: "2026-11-14",
          timeWindow: "Morning",
        },
        {
          deliveryStatus: "scheduled",
          scheduledDate: "2026-11-14",
          timeWindow: "Afternoon",
        },
      ),
    ).toEqual(["delivery_scheduled"]);
  });

  it("returns nothing when the time window changes without a date", () => {
    expect(
      events(
        { deliveryStatus: "pending", timeWindow: null },
        { deliveryStatus: "pending", timeWindow: "Morning" },
      ),
    ).toEqual([]);
  });

  it("returns nothing when a date is cleared", () => {
    expect(
      events(
        {
          deliveryStatus: "scheduled",
          scheduledDate: "2026-11-14",
        },
        { deliveryStatus: "pending", scheduledDate: null },
      ),
    ).toEqual([]);
  });

  it("returns nothing for a delivery date on an unpaid order", () => {
    expect(
      events(
        { orderStatus: "pending", deliveryStatus: "pending" },
        {
          orderStatus: "pending",
          deliveryStatus: "scheduled",
          scheduledDate: "2026-11-14",
        },
      ),
    ).toEqual([]);
  });

  it("returns nothing for cancelled or refunded orders", () => {
    for (const orderStatus of [
      "cancelled",
      "refunded",
      "partially_refunded",
    ] as const) {
      expect(
        events(
          { deliveryStatus: "pending" },
          {
            orderStatus,
            deliveryStatus: "scheduled",
            scheduledDate: "2026-11-14",
          },
        ),
      ).toEqual([]);
    }
  });

  it("returns out_for_delivery when the order becomes out for delivery", () => {
    expect(
      events(
        { orderStatus: "processing", deliveryStatus: "pending" },
        {
          orderStatus: "out_for_delivery",
          deliveryStatus: "pending",
        },
      ),
    ).toEqual(["out_for_delivery"]);
  });

  it("returns out_for_delivery when only the delivery becomes out for delivery", () => {
    expect(
      events(
        { orderStatus: "paid", deliveryStatus: "scheduled" },
        {
          orderStatus: "paid",
          deliveryStatus: "out_for_delivery",
        },
      ),
    ).toEqual(["out_for_delivery"]);
  });

  it("returns delivered when the order becomes delivered", () => {
    expect(
      events(
        { orderStatus: "out_for_delivery", deliveryStatus: "out_for_delivery" },
        { orderStatus: "delivered", deliveryStatus: "out_for_delivery" },
      ),
    ).toEqual(["delivered"]);
  });

  it("returns delivered when only the delivery becomes delivered", () => {
    expect(
      events(
        { orderStatus: "out_for_delivery", deliveryStatus: "out_for_delivery" },
        {
          orderStatus: "out_for_delivery",
          deliveryStatus: "delivered",
        },
      ),
    ).toEqual(["delivered"]);
  });

  it("returns delivered alone when a date change happens at delivery", () => {
    expect(
      events(
        {
          orderStatus: "out_for_delivery",
          deliveryStatus: "out_for_delivery",
          scheduledDate: "2026-11-14",
        },
        {
          orderStatus: "delivered",
          deliveryStatus: "delivered",
          scheduledDate: "2026-11-15",
        },
      ),
    ).toEqual(["delivered"]);
  });

  it("drops delivery_scheduled when out for delivery is due", () => {
    expect(
      events(
        { orderStatus: "processing", deliveryStatus: "pending" },
        {
          orderStatus: "out_for_delivery",
          deliveryStatus: "out_for_delivery",
          scheduledDate: "2026-11-14",
        },
      ),
    ).toEqual(["out_for_delivery"]);
  });

  it("returns nothing for backward order moves", () => {
    expect(
      events(
        {
          orderStatus: "delivered",
          deliveryStatus: "scheduled",
          scheduledDate: "2026-11-14",
        },
        {
          orderStatus: "processing",
          deliveryStatus: "scheduled",
          scheduledDate: "2026-11-20",
        },
      ),
    ).toEqual([]);
  });

  it("returns nothing for backward delivery moves", () => {
    expect(
      events(
        {
          orderStatus: "processing",
          deliveryStatus: "delivered",
          scheduledDate: "2026-11-14",
        },
        {
          orderStatus: "processing",
          deliveryStatus: "scheduled",
          scheduledDate: "2026-11-20",
        },
      ),
    ).toEqual([]);
  });
});
