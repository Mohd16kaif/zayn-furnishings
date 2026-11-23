import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeRefundDb,
  createFakeRefundState,
  type FakeRefundState,
} from "./helpers/fakeRefundDb";

const mock = vi.hoisted(() => ({
  role: "owner" as "owner" | "staff",
  adminId: "admin-1",
  db: null as unknown,
}));

vi.mock("../src/emails/sender", () => ({
  getEmailSender: () => ({
    name: "log",
    send: async () => ({ providerMessageId: "pm_test" }),
  }),
}));

vi.mock("../src/middleware/requireAdmin", () => ({
  requireAdmin: (
    req: Record<string, unknown>,
    _res: unknown,
    next: () => void,
  ) => {
    req.admin = {
      id: mock.adminId,
      role: mock.role,
      email: "owner@example.com",
      name: "Owner",
    };
    next();
  },
}));

vi.mock("../src/db/client", () => ({
  get db() {
    return mock.db;
  },
  connection: null,
}));

import { adminOrdersRouter } from "../src/routes/adminOrders";

const ORDER_NUMBER = "ZF-100013";

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    orderNumber: ORDER_NUMBER,
    status: "paid",
    totalCents: 10000,
    subtotalCents: 10000,
    discountCents: 0,
    deliveryFeeCents: 0,
    taxCents: 0,
    stripePaymentIntentId: "pi_123",
    email: "customer@example.com",
    shippingName: "Jordan Lee",
    shippingLine1: "1 Main St",
    shippingLine2: null,
    shippingCity: "Brooklyn",
    shippingState: "NY",
    shippingZip: "11201",
    shippingPhone: null,
    internalNotes: null,
    createdAt: new Date("2026-11-13T10:00:00.000Z"),
    updatedAt: new Date("2026-11-13T10:00:00.000Z"),
    ...overrides,
  };
}

function deliveryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "delivery-1",
    orderId: "order-1",
    status: "scheduled",
    method: "own_truck",
    partnerName: "Zayn Delivery Co.",
    trackingNumber: null,
    scheduledDate: "2026-11-14",
    timeWindow: "Morning",
    driverNotes: null,
    carrier: null,
    deliveredAt: null,
    createdAt: new Date("2026-11-13T10:00:00.000Z"),
    updatedAt: new Date("2026-11-13T10:00:00.000Z"),
    ...overrides,
  };
}

function paymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "payment-1",
    orderId: "order-1",
    provider: "stripe",
    providerPaymentId: "pi_123",
    amountCents: 10000,
    currency: "usd",
    status: "succeeded",
    rawEventId: "pi_succeeded:pi_123",
    createdAt: new Date("2026-11-13T10:00:00.000Z"),
    ...overrides,
  };
}

function notificationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "notification-existing",
    orderId: "order-1",
    channel: "email",
    template: "order_confirmation",
    toAddress: "customer@example.com",
    dedupeKey: "order_confirmation:order-1",
    status: "sent",
    attempts: 1,
    providerMessageId: "pm_1",
    sentAt: new Date("2026-11-13T10:00:00.000Z"),
    error: null,
    createdAt: new Date("2026-11-13T10:00:00.000Z"),
    updatedAt: new Date("2026-11-13T10:00:00.000Z"),
    ...overrides,
  };
}

let server: Server;
let baseUrl: string;
let state: FakeRefundState;

beforeEach(async () => {
  mock.role = "owner";
  mock.adminId = `admin-${Date.now()}-${Math.random()}`;
  state = createFakeRefundState({
    orders: [orderRow()],
    payments: [paymentRow()],
    deliveries: [deliveryRow()],
    notifications: [],
  });
  mock.db = createFakeRefundDb(state);

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

async function resend(template: string) {
  return fetch(
    `${baseUrl}/admin/orders/${ORDER_NUMBER}/messages/${template}/resend`,
    { method: "POST" },
  );
}

describe("POST resend", () => {
  it("allows each resendable template when the order state matches", async () => {
    expect((await resend("order_confirmation")).status).toBe(200);

    expect((await resend("delivery_scheduled")).status).toBe(200);

    state.orders[0].status = "out_for_delivery";
    state.deliveries[0].status = "out_for_delivery";
    expect((await resend("out_for_delivery")).status).toBe(200);

    state.orders[0].status = "delivered";
    state.deliveries[0].status = "delivered";
    expect((await resend("delivered")).status).toBe(200);

    expect(state.notifications).toHaveLength(4);
    expect(state.audits).toHaveLength(4);
    expect(state.audits[0]).toMatchObject({
      action: "order.message_resent",
      entity: "order",
      entityId: "order-1",
    });
  });

  it("allows staff to resend", async () => {
    mock.role = "staff";

    const response = await resend("order_confirmation");

    expect(response.status).toBe(200);
  });

  it("rejects pending and cancelled orders", async () => {
    state.orders[0].status = "pending";

    expect((await resend("order_confirmation")).status).toBe(409);

    state.orders[0].status = "cancelled";
    expect((await resend("order_confirmation")).status).toBe(409);
  });

  it("requires a delivery date for delivery_scheduled", async () => {
    state.deliveries[0].scheduledDate = null;

    const response = await resend("delivery_scheduled");

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "Add a delivery date before sending this email.",
    });
  });

  it("requires an out-for-delivery or delivered state for out_for_delivery", async () => {
    state.orders[0].status = "processing";
    state.deliveries[0].status = "scheduled";

    expect((await resend("out_for_delivery")).status).toBe(409);

    state.deliveries[0].status = "delivered";
    expect((await resend("out_for_delivery")).status).toBe(200);
  });

  it("requires delivered for the delivered template", async () => {
    state.orders[0].status = "out_for_delivery";
    state.deliveries[0].status = "out_for_delivery";

    expect((await resend("delivered")).status).toBe(409);

    state.orders[0].status = "delivered";
    expect((await resend("delivered")).status).toBe(200);
  });

  it("never resends refund_issued", async () => {
    const response = await resend("refund_issued");

    expect(response.status).toBe(404);
    expect(state.notifications).toHaveLength(0);
  });

  it("creates a new distinct dedupe key on every resend", async () => {
    await resend("delivery_scheduled");
    await resend("delivery_scheduled");

    expect(state.notifications).toHaveLength(2);

    const keys = state.notifications.map((row) => row.dedupeKey);

    expect(keys[0]).toMatch(
      /^delivery_scheduled:order-1:resend:[0-9a-f-]{36}$/,
    );
    expect(keys[1]).toMatch(
      /^delivery_scheduled:order-1:resend:[0-9a-f-]{36}$/,
    );
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("rate limits after five resends in a minute", async () => {
    for (let index = 0; index < 5; index += 1) {
      expect((await resend("order_confirmation")).status).toBe(200);
    }

    const limited = await resend("order_confirmation");

    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({
      error:
        "Too many email resends. Please wait a minute and try again.",
    });
  });
});

describe("GET order detail messages", () => {
  it("lists customer messages with a masked address and short error", async () => {
    state.notifications.push(
      notificationRow({
        id: "notification-2",
        template: "delivery_scheduled",
        status: "failed",
        error:
          "Provider rejected customer@example.com with a very long reason that must be shortened in the admin response.",
        createdAt: new Date("2026-11-13T11:00:00.000Z"),
      }),
    );

    const response = await fetch(
      `${baseUrl}/admin/orders/${ORDER_NUMBER}`,
    );

    expect(response.status).toBe(200);

    const body = await response.json();
    const message = body.messages.find(
      (row: { id: string }) => row.id === "notification-2",
    );

    expect(message).toMatchObject({
      id: "notification-2",
      template: "delivery_scheduled",
      to_masked: "cu***@example.com",
      status: "failed",
    });
    expect(message.error).not.toContain("customer@example.com");
    expect(message.error).toContain("cu***@example.com");
    expect(message.error.length).toBeLessThanOrEqual(160);
  });
});
