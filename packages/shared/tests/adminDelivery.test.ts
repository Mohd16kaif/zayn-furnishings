import { describe, expect, it } from "vitest";
import {
  DELIVERY_METHODS,
  DELIVERY_STATUSES,
  deliveryOrderSync,
  deliveryStatusForOrderStatus,
  deliveryUpdateSchema,
  type DeliveryOrderSyncResult,
  type DeliveryStatus,
} from "../src/adminDelivery";
import {
  ORDER_STATUSES,
  type OrderStatus,
} from "../src/orderTransitions";

const BLOCKED_ORDER_STATUSES = new Set<OrderStatus>([
  "pending",
  "cancelled",
  "refunded",
  "partially_refunded",
]);

const FULFILLMENT_FLOW: OrderStatus[] = [
  "paid",
  "processing",
  "out_for_delivery",
  "delivered",
];

function expectedSync(
  deliveryStatus: DeliveryStatus,
  orderStatus: OrderStatus,
): DeliveryOrderSyncResult {
  if (BLOCKED_ORDER_STATUSES.has(orderStatus)) {
    return { status: "error", reason: "delivery_unavailable" };
  }

  const target: OrderStatus | null =
    deliveryStatus === "out_for_delivery"
      ? "out_for_delivery"
      : deliveryStatus === "delivered"
        ? "delivered"
        : null;

  if (!target) {
    return { status: "no_change" };
  }

  const currentIndex = FULFILLMENT_FLOW.indexOf(orderStatus);
  const targetIndex = FULFILLMENT_FLOW.indexOf(target);

  if (currentIndex >= targetIndex) {
    return { status: "no_change" };
  }

  return { status: "advance", orderStatus: target };
}

describe("deliveryStatusForOrderStatus", () => {
  it("maps every order status to its closest delivery status", () => {
    expect(deliveryStatusForOrderStatus("pending")).toBe("pending");
    expect(deliveryStatusForOrderStatus("paid")).toBe("pending");
    expect(deliveryStatusForOrderStatus("processing")).toBe("scheduled");
    expect(deliveryStatusForOrderStatus("out_for_delivery")).toBe(
      "out_for_delivery",
    );
    expect(deliveryStatusForOrderStatus("delivered")).toBe("delivered");
    expect(deliveryStatusForOrderStatus("cancelled")).toBe("cancelled");
    expect(deliveryStatusForOrderStatus("refunded")).toBe("cancelled");
    expect(deliveryStatusForOrderStatus("partially_refunded")).toBe(
      "cancelled",
    );
  });

  it("only returns values from the delivery status enum", () => {
    for (const orderStatus of ORDER_STATUSES) {
      expect(DELIVERY_STATUSES).toContain(
        deliveryStatusForOrderStatus(orderStatus),
      );
    }
  });
});

describe("deliveryOrderSync", () => {
  for (const role of ["owner", "staff"] as const) {
    for (const deliveryStatus of DELIVERY_STATUSES) {
      for (const orderStatus of ORDER_STATUSES) {
        it(`${role}: delivery ${deliveryStatus} / order ${orderStatus}`, () => {
          expect(
            deliveryOrderSync(deliveryStatus, orderStatus, role),
          ).toEqual(expectedSync(deliveryStatus, orderStatus));
        });
      }
    }
  }

  it("never manages delivery for blocked order states", () => {
    for (const role of ["owner", "staff"] as const) {
      for (const orderStatus of BLOCKED_ORDER_STATUSES) {
        for (const deliveryStatus of DELIVERY_STATUSES) {
          expect(
            deliveryOrderSync(deliveryStatus, orderStatus, role),
          ).toEqual({
            status: "error",
            reason: "delivery_unavailable",
          });
        }
      }
    }
  });

  it("never moves an order backward when delivery changes", () => {
    expect(
      deliveryOrderSync("out_for_delivery", "delivered", "owner"),
    ).toEqual({ status: "no_change" });
    expect(
      deliveryOrderSync("out_for_delivery", "out_for_delivery", "owner"),
    ).toEqual({ status: "no_change" });
    expect(
      deliveryOrderSync("delivered", "delivered", "owner"),
    ).toEqual({ status: "no_change" });
  });
});

describe("deliveryUpdateSchema", () => {
  const valid = {
    method: "own_truck",
    partner_name: "Zayn Delivery Co.",
    tracking: "1Z999",
    scheduled_date: "2026-12-01",
    time_window: "Morning (8am to 12pm)",
    driver_notes: "Call on arrival.",
    status: "scheduled",
  };

  it("accepts and trims a complete update", () => {
    const parsed = deliveryUpdateSchema.parse({
      ...valid,
      partner_name: "  Zayn Delivery Co.  ",
    });

    expect(parsed.partner_name).toBe("Zayn Delivery Co.");
    expect(parsed.method).toBe("own_truck");
    expect(parsed.status).toBe("scheduled");
  });

  it("accepts optional fields being omitted or cleared", () => {
    expect(
      deliveryUpdateSchema.parse({
        method: "pickup",
        status: "pending",
      }),
    ).toMatchObject({ method: "pickup", status: "pending" });

    expect(
      deliveryUpdateSchema.parse({
        method: "pickup",
        status: "pending",
        partner_name: null,
        tracking: null,
        scheduled_date: null,
        time_window: null,
        driver_notes: null,
      }),
    ).toMatchObject({ partner_name: null, scheduled_date: null });
  });

  it("rejects unknown methods and statuses", () => {
    expect(
      deliveryUpdateSchema.safeParse({
        ...valid,
        method: "drone",
      }).success,
    ).toBe(false);
    expect(
      deliveryUpdateSchema.safeParse({
        ...valid,
        status: "lost",
      }).success,
    ).toBe(false);
  });

  it("rejects invalid calendar dates", () => {
    expect(
      deliveryUpdateSchema.safeParse({
        ...valid,
        scheduled_date: "2026-02-30",
      }).success,
    ).toBe(false);
    expect(
      deliveryUpdateSchema.safeParse({
        ...valid,
        scheduled_date: "12/01/2026",
      }).success,
    ).toBe(false);
  });

  it("enforces field length limits", () => {
    expect(
      deliveryUpdateSchema.safeParse({
        ...valid,
        partner_name: "x".repeat(121),
      }).success,
    ).toBe(false);
    expect(
      deliveryUpdateSchema.safeParse({
        ...valid,
        time_window: "x".repeat(41),
      }).success,
    ).toBe(false);
    expect(
      deliveryUpdateSchema.safeParse({
        ...valid,
        driver_notes: "x".repeat(1001),
      }).success,
    ).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(
      deliveryUpdateSchema.safeParse({
        ...valid,
        order_id: "not-allowed",
      }).success,
    ).toBe(false);
  });

  it("keeps every method available to the admin UI", () => {
    for (const method of DELIVERY_METHODS) {
      expect(
        deliveryUpdateSchema.safeParse({
          method,
          status: "pending",
        }).success,
      ).toBe(true);
    }
  });
});
