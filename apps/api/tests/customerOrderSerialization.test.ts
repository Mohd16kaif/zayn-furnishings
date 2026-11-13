import { describe, expect, it } from "vitest";
import { serializeCustomerDelivery } from "../src/lib/customerOrderSerialization";

describe("serializeCustomerDelivery", () => {
  it("returns only the customer-safe delivery fields", () => {
    const result = serializeCustomerDelivery({
      status: "out_for_delivery",
      method: "own_truck",
      partnerName: "Zayn Delivery Co.",
      scheduledDate: "2026-12-01",
      timeWindow: "Morning (8am to 12pm)",
      trackingNumber: "TRACK-123",
      carrier: "Zayn Delivery Co.",
      driverNotes: "Gate code 4821. Call the customer on arrival.",
    });

    expect(result).toEqual({
      status: "out_for_delivery",
      method: "own_truck",
      partner_name: "Zayn Delivery Co.",
      scheduled_date: "2026-12-01",
      time_window: "Morning (8am to 12pm)",
      tracking_number: "TRACK-123",
      carrier: "Zayn Delivery Co.",
    });
    expect(Object.keys(result).sort()).toEqual(
      [
        "carrier",
        "method",
        "partner_name",
        "scheduled_date",
        "status",
        "time_window",
        "tracking_number",
      ].sort(),
    );
    expect(result).not.toHaveProperty("driver_notes");
    expect(result).not.toHaveProperty("internal_notes");
    expect(JSON.stringify(result)).not.toContain("Gate code");
  });

  it("keeps null delivery details explicit without leaking notes", () => {
    const result = serializeCustomerDelivery({
      status: "pending",
      method: null,
      partnerName: null,
      scheduledDate: null,
      timeWindow: null,
      trackingNumber: null,
      carrier: null,
      driverNotes: "Private driver instruction",
    });

    expect(result).toEqual({
      status: "pending",
      method: null,
      partner_name: null,
      scheduled_date: null,
      time_window: null,
      tracking_number: null,
      carrier: null,
    });
    expect(JSON.stringify(result)).not.toContain("Private driver instruction");
  });
});
