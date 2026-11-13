import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  order: null as Record<string, unknown> | null,
  delivery: null as Record<string, unknown> | null,
  deliveryUpdates: [] as Record<string, unknown>[],
  orderUpdates: [] as Record<string, unknown>[],
  audits: [] as Record<string, unknown>[],
}));

vi.mock("../src/middleware/requireAdmin", () => ({
  requireAdmin: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.admin = {
      id: "00000000-0000-0000-0000-000000000001",
      role: "owner",
      email: "owner@example.com",
      name: "Owner",
    };
    next();
  },
}));

vi.mock("../src/db/client", async () => {
  const { deliveries } = await import("../src/db/schema");

  function createTransaction() {
    let selectCount = 0;

    return {
      select() {
        selectCount += 1;
        const index = selectCount;
        const chain = {
          from() {
            return chain;
          },
          where() {
            return chain;
          },
          limit() {
            return chain;
          },
          for() {
            return Promise.resolve(
              index === 1 ? [state.order] : [state.delivery],
            );
          },
        };

        return chain;
      },
      update(table: unknown) {
        const isDelivery = table === deliveries;
        let values: Record<string, unknown> = {};
        const chain = {
          set(next: Record<string, unknown>) {
            values = next;
            return chain;
          },
          where() {
            if (isDelivery) {
              state.deliveryUpdates.push(values);
              const updated = { ...state.delivery, ...values };
              state.delivery = updated;

              return {
                returning: () => Promise.resolve([updated]),
              };
            }

            state.orderUpdates.push(values);

            return Promise.resolve(undefined);
          },
        };

        return chain;
      },
      insert(table: unknown) {
        return {
          values(values: Record<string, unknown>) {
            state.audits.push({ table, values });

            return Promise.resolve(undefined);
          },
        };
      },
    };
  }

  return {
    db: {
      transaction: async (
        callback: (tx: ReturnType<typeof createTransaction>) => Promise<unknown>,
      ) => callback(createTransaction()),
    },
    connection: null,
  };
});

import { adminOrdersRouter } from "../src/routes/adminOrders";

function baseOrder(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-11-13T10:00:00.000Z");

  return {
    id: "order-1",
    orderNumber: "ZF-100013",
    status: "delivered",
    stripePaymentIntentId: null,
    cancelledAt: null,
    updatedAt: now,
    ...overrides,
  };
}

function baseDelivery(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-11-13T10:00:00.000Z");

  return {
    id: "delivery-1",
    orderId: "order-1",
    status: "out_for_delivery",
    method: "own_truck",
    partnerName: "Zayn Delivery Co.",
    trackingNumber: null,
    scheduledDate: "2026-11-15",
    timeWindow: null,
    driverNotes: null,
    carrier: null,
    deliveredAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

let server: Server;
let baseUrl: string;

beforeEach(async () => {
  state.order = baseOrder();
  state.delivery = baseDelivery();
  state.deliveryUpdates.length = 0;
  state.orderUpdates.length = 0;
  state.audits.length = 0;

  const app = express();
  app.use(express.json());
  app.use("/admin", adminOrdersRouter);

  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
});

async function patchDelivery(body: Record<string, unknown>) {
  return fetch(`${baseUrl}/admin/orders/ZF-100013/delivery`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function patchStatus(body: Record<string, unknown>) {
  return fetch(`${baseUrl}/admin/orders/ZF-100013/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const deliveryBody = {
  method: "own_truck",
  partner_name: "Zayn Delivery Co.",
  tracking: null,
  scheduled_date: "2026-11-15",
  time_window: null,
  driver_notes: null,
};

describe("delivery PATCH on an already delivered order", () => {
  it("updates the delivery row to delivered and skips the order advance", async () => {
    const response = await patchDelivery({
      ...deliveryBody,
      status: "delivered",
    });

    expect(response.status).toBe(200);

    const body = await response.json();

    expect(body.status).toBe("delivered");
    expect(body.delivery.status).toBe("delivered");
    expect(body.delivery.delivered_at).toBeTruthy();
    expect(state.deliveryUpdates).toHaveLength(1);
    expect(state.deliveryUpdates[0]).toMatchObject({
      status: "delivered",
    });
    expect(state.orderUpdates).toHaveLength(0);

    const audit = state.audits.find(
      (entry) =>
        (entry.values as { action?: string }).action ===
        "order.delivery_updated",
    );

    expect(audit).toBeTruthy();
    expect(audit?.values).toMatchObject({
      details: {
        order_status_before: "delivered",
        order_status_after: "delivered",
      },
    });
  });
});

describe("status PATCH delivery sync", () => {
  it("uses a scheduled date when moving a paid order to processing", async () => {
    state.order = baseOrder({ status: "paid" });
    state.delivery = baseDelivery({ status: "pending" });

    const response = await patchStatus({ status: "processing" });

    expect(response.status).toBe(200);
    expect(state.deliveryUpdates).toHaveLength(1);
    expect(state.deliveryUpdates[0]).toMatchObject({
      status: "scheduled",
    });
  });

  it("uses pending when moving a paid order to processing without a date", async () => {
    state.order = baseOrder({ status: "paid" });
    state.delivery = baseDelivery({
      status: "pending",
      scheduledDate: null,
    });

    const response = await patchStatus({ status: "processing" });

    expect(response.status).toBe(200);
    expect(state.deliveryUpdates).toHaveLength(0);
    expect(state.delivery).toMatchObject({ status: "pending" });

    const audit = state.audits.find(
      (entry) =>
        (entry.values as { action?: string }).action ===
        "order.status_changed",
    );

    expect(audit?.values).toMatchObject({
      details: {
        delivery_status_after: "pending",
        delivery_changed: false,
      },
    });
  });
});
