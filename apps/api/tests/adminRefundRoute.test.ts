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
  createRefund: vi.fn(),
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

vi.mock("../src/lib/stripe", () => ({
  STRIPE_API_VERSION: "2024-06-20",
  stripe: {
    refunds: {
      create: mock.createRefund,
    },
  },
}));

import { adminOrdersRouter } from "../src/routes/adminOrders";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_NUMBER = "ZF-100013";

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    orderNumber: ORDER_NUMBER,
    status: "paid",
    totalCents: 10000,
    stripePaymentIntentId: "pi_123",
    email: "customer@example.com",
    createdAt: new Date("2026-11-13T10:00:00.000Z"),
    updatedAt: new Date("2026-11-13T10:00:00.000Z"),
    ...overrides,
  };
}

function succeededPayment(overrides: Record<string, unknown> = {}) {
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

function deliveryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "delivery-1",
    orderId: "order-1",
    status: "pending",
    method: "own_truck",
    partnerName: null,
    scheduledDate: null,
    timeWindow: null,
    trackingNumber: null,
    carrier: null,
    driverNotes: null,
    deliveredAt: null,
    createdAt: new Date("2026-11-13T10:00:00.000Z"),
    updatedAt: new Date("2026-11-13T10:00:00.000Z"),
    ...overrides,
  };
}

function itemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    orderId: "order-1",
    productId: "product-1",
    nameSnapshot: "Oak Chair",
    skuSnapshot: "CHAIR-1",
    imageUrlSnapshot: null,
    unitPriceCents: 10000,
    quantity: 1,
    lineTotalCents: 10000,
    ...overrides,
  };
}

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "product-1",
    name: "Oak Chair",
    stockQty: 3,
    ...overrides,
  };
}

function stripeRefund(overrides: Record<string, unknown> = {}) {
  return {
    id: "re_123",
    amount: 10000,
    status: "succeeded",
    created: 1763031600,
    ...overrides,
  };
}

let server: Server;
let baseUrl: string;
let state: FakeRefundState;

beforeEach(async () => {
  mock.role = "owner";
  mock.adminId = `admin-${Date.now()}-${Math.random()}`;
  mock.createRefund.mockReset();
  mock.createRefund.mockResolvedValue(stripeRefund());

  state = createFakeRefundState({
    orders: [orderRow()],
    payments: [succeededPayment()],
    deliveries: [deliveryRow()],
    orderItems: [itemRow()],
    products: [productRow()],
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

async function postRefund(body: Record<string, unknown>) {
  return fetch(`${baseUrl}/admin/orders/${ORDER_NUMBER}/refund`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const baseBody = {
  request_id: REQUEST_ID,
  reason: "damaged",
  note: "Chair arrived with a broken leg.",
};

describe("GET /admin/orders/:orderNumber refund fields", () => {
  it("computes can_refund from the role and the ledger", async () => {
    const ownerResponse = await fetch(
      `${baseUrl}/admin/orders/${ORDER_NUMBER}`,
    );

    expect(ownerResponse.status).toBe(200);

    const ownerBody = await ownerResponse.json();

    expect(ownerBody).toMatchObject({
      total_refunded_cents: 0,
      refundable_remaining_cents: 10000,
      can_refund: true,
      refunds: [],
    });

    mock.role = "staff";

    const staffResponse = await fetch(
      `${baseUrl}/admin/orders/${ORDER_NUMBER}`,
    );
    const staffBody = await staffResponse.json();

    expect(staffBody.can_refund).toBe(false);
  });
});

describe("POST /admin/orders/:orderNumber/refund", () => {
  it("is owner only", async () => {
    mock.role = "staff";

    const response = await postRefund(baseBody);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: "Only the owner can issue refunds.",
    });
    expect(mock.createRefund).not.toHaveBeenCalled();
  });

  it("refunds the full remaining amount and derives the order status", async () => {
    const response = await postRefund(baseBody);

    expect(response.status).toBe(200);
    expect(mock.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_intent: "pi_123",
        amount: 10000,
        metadata: { order_number: ORDER_NUMBER },
      }),
      expect.objectContaining({
        idempotencyKey: `order-refund-order-1-${REQUEST_ID}`,
        timeout: 10000,
      }),
    );

    const body = await response.json();

    expect(body).toMatchObject({
      order_number: ORDER_NUMBER,
      status: "refunded",
      refund: { stripe_refund_id: "re_123", amount_cents: 10000 },
      total_refunded_cents: 10000,
      refundable_remaining_cents: 0,
    });
    expect(state.orders[0].status).toBe("refunded");
    expect(state.deliveries[0].status).toBe("cancelled");
    expect(state.payments).toHaveLength(2);
    expect(state.payments[1]).toMatchObject({
      amountCents: 10000,
      status: "refunded",
      rawEventId: "refund:re_123",
    });
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      action: "order.refunded",
      details: {
        amount_cents: 10000,
        reason: "damaged",
        note: "Chair arrived with a broken leg.",
        restock: false,
        stripe_refund_id: "re_123",
        resulting_order_status: "refunded",
      },
    });
  });

  it("supports partial refunds and only sends Stripe's customer reason", async () => {
    mock.createRefund.mockResolvedValue(stripeRefund({ amount: 2500 }));

    const response = await postRefund({
      ...baseBody,
      amount_cents: 2500,
      reason: "requested_by_customer",
    });

    expect(response.status).toBe(200);
    expect(mock.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2500,
        reason: "requested_by_customer",
      }),
      expect.anything(),
    );

    const body = await response.json();

    expect(body.status).toBe("partially_refunded");
    expect(body.total_refunded_cents).toBe(2500);
    expect(state.orders[0].status).toBe("partially_refunded");
    expect(state.deliveries[0].status).toBe("pending");
  });

  it("rejects more than the remaining balance before calling Stripe", async () => {
    const response = await postRefund({
      ...baseBody,
      amount_cents: 10001,
    });

    expect(response.status).toBe(400);
    expect(mock.createRefund).not.toHaveBeenCalled();
    expect(state.payments).toHaveLength(1);
  });

  it("rejects restock unless the refund is the full remaining amount", async () => {
    const response = await postRefund({
      ...baseBody,
      amount_cents: 5000,
      restock: true,
    });

    expect(response.status).toBe(400);
    expect(mock.createRefund).not.toHaveBeenCalled();
  });

  it("restocks items once when the order is fully refunded", async () => {
    const response = await postRefund({ ...baseBody, restock: true });

    expect(response.status).toBe(200);
    expect(state.products[0].stockQty).toBe(4);
    expect(state.stockMovements).toHaveLength(1);
    expect(state.stockMovements[0]).toMatchObject({
      productId: "product-1",
      change: 1,
      reason: "return",
      orderId: "order-1",
      adminUserId: mock.adminId,
      note: "Chair arrived with a broken leg.",
    });
  });

  it("does not restock twice when a return movement already exists", async () => {
    state.stockMovements.push({
      id: "movement-existing",
      productId: "product-1",
      change: 1,
      reason: "return",
      orderId: "order-1",
    });

    const response = await postRefund({ ...baseBody, restock: true });

    expect(response.status).toBe(200);
    expect(state.products[0].stockQty).toBe(3);
    expect(state.stockMovements).toHaveLength(1);
  });

  it("returns 409 and changes nothing when Stripe rejects the amount", async () => {
    mock.createRefund.mockRejectedValue(
      Object.assign(new Error("Amount exceeds refundable amount"), {
        type: "StripeInvalidRequestError",
      }),
    );

    const response = await postRefund(baseBody);

    expect(response.status).toBe(409);
    expect(state.payments).toHaveLength(1);
    expect(state.orders[0].status).toBe("paid");
    expect(state.audits).toHaveLength(0);
  });
});
